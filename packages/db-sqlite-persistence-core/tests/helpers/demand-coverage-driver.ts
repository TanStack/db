import { vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { persistedCollectionOptions } from '../../src/index.js'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type {
  SQLiteCorePersistenceAdapter,
  SQLiteDriver,
} from '../../src/index.js'
import type { SourceEvent } from '../persisted-demand-coverage-model-oracle.js'

/**
 * The production driver shared by the persisted demand coverage oracle
 * (`tests/persisted-demand-coverage-oracle.test.ts`) and its generated
 * campaign (`tests/persisted-demand-coverage-campaign-oracle.test.ts`). It
 * drives the real persisted wrapper over a generic on-demand source and
 * records the source's own log for the shared judgment; it holds no model and
 * no expected result.
 */

export type Row = { id: string; group: string; rank: number; value: string }

// Session 2 reads through this wrapper, which answers each read on a later
// macrotask, as a worker-backed or OPFS driver does. A driver that answers
// within one microtask turn hides any work that happens between the
// wrapper's own awaits, such as an upstream failure during a coverage read.
// `setImmediate` stays real under the fake clock, so the drains below yield
// to it.
export function withMacrotaskReads(driver: SQLiteDriver): SQLiteDriver {
  return {
    ...driver,
    query: (sql, params) =>
      new Promise<void>((resolve) => setImmediate(resolve)).then(() =>
        driver.query(sql, params),
      ),
  }
}

export const realMacrotask = () =>
  new Promise<void>((resolve) => setImmediate(resolve))

// ORC-010: run a check, then every cleanup. A cleanup failure never replaces
// the primary failure; both survive in one AggregateError.
export async function withCleanup<T>(
  check: () => Promise<T>,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<T> {
  let result: T | undefined
  let primary: { error: unknown } | undefined
  try {
    result = await check()
  } catch (error) {
    primary = { error }
  }
  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (primary) {
    if (cleanupFailures.length === 0) throw primary.error
    throw new AggregateError(
      [primary.error, ...cleanupFailures],
      `Demand-coverage check and cleanup both failed`,
      { cause: primary.error },
    )
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) {
    throw new AggregateError(cleanupFailures, `Demand-coverage cleanup failed`)
  }
  return result as T
}

export function useFakeClock(): void {
  vi.useFakeTimers({
    toFake: [
      `setTimeout`,
      `clearTimeout`,
      `setInterval`,
      `clearInterval`,
      `Date`,
    ],
  })
}

export async function drain(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await realMacrotask()
  }
}

export type Upstream = {
  calls: Array<LoadSubsetOptions>
  // The row IDs the Collection showed when each load was forwarded.
  visibleAtCall: Array<Array<string>>
  pendingCount: () => number
  answer: (rows: ReadonlyArray<Row>) => Promise<void>
  fail: (error: unknown) => void
  truncate: () => Promise<void>
  // Commits a snapshot transaction of these rows: it replaces every row.
  snapshot: (rows: ReadonlyArray<Row>) => Promise<void>
  // When set, each later load rejects as soon as it is called.
  rejectAtOnce: boolean
  // When set, the next load truncates synchronously inside the source's
  // `loadSubset` call, after the source received the load.
  truncateInNextLoad: boolean
  // Writes rows without settling any load.
  write: (rows: ReadonlyArray<Row>) => Promise<void>
  // Settles only the oldest pending load, without writing rows.
  settleOldest: () => void
  startScopedRecovery: () => Promise<void>
  // Deletes rows in one sync transaction.
  remove: (rows: ReadonlyArray<Row>) => Promise<void>
  // Updates rows in one sync transaction.
  update: (rows: ReadonlyArray<Row>) => Promise<void>
  // The source's own log of what it did, for the shared judgment in
  // `tests/persisted-demand-coverage-model-oracle.ts`. Each source is one
  // sync run. A load is current when no truncate, snapshot, or generation
  // change came between the source receiving it and settling it, and aborted
  // when core aborted its signal before the source settled it.
  events: Array<SourceEvent>
  // When the source received each load (`Date.now()`, so the fake clock
  // where a history installs one).
  arrivedAt: Map<LoadSubsetOptions, number>
}

const rowEvent = (rows: ReadonlyArray<Row>): SourceEvent => ({
  type: `rows`,
  rows: rows.map((row) => [row.id, { group: row.group, rank: row.rank }]),
})

// A generic on-demand source. Each load waits until the test answers or
// fails it. An answer writes the rows in one sync transaction and settles
// every pending load after its applied receipt.
export function onDemandSource(
  adapter: SQLiteCorePersistenceAdapter,
  waitMs: number,
  extra: { onInsert?: () => Promise<void> } = {},
): { collection: Collection<Row, string, any>; upstream: Upstream } {
  const pending: Array<{
    resolve: () => void
    reject: (error: unknown) => void
    options: LoadSubsetOptions
    epoch: number
  }> = []
  // How many truncates and generation changes the source has seen.
  let epoch = 0
  const settle = (load: (typeof pending)[number]) => {
    upstream.events.push({
      type: `settled`,
      load: load.options,
      current: load.epoch === epoch,
      ...(load.options.signal?.aborted ? { aborted: true } : {}),
    })
    load.resolve()
  }
  let write: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  let truncate: (() => unknown) | undefined
  let snapshot: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  let startScopedRecovery: (() => Promise<void>) | undefined
  let remove: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  let update: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  const upstream: Upstream = {
    calls: [],
    events: [{ type: `sync run starts` }],
    arrivedAt: new Map(),
    visibleAtCall: [],
    rejectAtOnce: false,
    truncateInNextLoad: false,
    pendingCount: () => pending.length,
    answer: async (rows) => {
      await write?.(rows)
      upstream.events.push(rowEvent(rows))
      for (const load of pending.splice(0)) settle(load)
    },
    fail: (error) => {
      for (const load of pending.splice(0)) {
        upstream.events.push({ type: `failed`, load: load.options })
        load.reject(error)
      }
    },
    truncate: async () => {
      epoch++
      await truncate?.()
      upstream.events.push({ type: `truncate` })
    },
    snapshot: async (rows) => {
      epoch++
      await snapshot?.(rows)
      upstream.events.push({
        type: `snapshot`,
        rows: rows.map((row) => [row.id, { group: row.group, rank: row.rank }]),
      })
    },
    write: async (rows) => {
      await write?.(rows)
      upstream.events.push(rowEvent(rows))
    },
    settleOldest: () => {
      const load = pending.shift()
      if (load) settle(load)
    },
    // Production starts recovery synchronously, so the log records it first.
    startScopedRecovery: async () => {
      epoch++
      // Premise: the sync run is active, so the recovery really starts.
      if (!startScopedRecovery) {
        throw new Error(`scoped recovery needs an active sync run`)
      }
      upstream.events.push({ type: `scoped recovery starts` })
      await startScopedRecovery()
    },
    remove: async (rows) => {
      await remove?.(rows)
      for (const row of rows)
        upstream.events.push({ type: `delete`, id: row.id })
    },
    update: async (rows) => {
      await update?.(rows)
      upstream.events.push(rowEvent(rows))
    },
  }
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `demand-coverage-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: waitMs },
      persistence: { adapter },
      ...(extra.onInsert ? { onInsert: extra.onInsert } : {}),
      sync: {
        sync: (params) => {
          write = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `insert`, value })
            return params.commit()
          }
          truncate = () => {
            params.begin()
            params.truncate()
            return params.commit()
          }
          snapshot = (rows) => {
            params.begin({ snapshot: true })
            for (const value of rows) params.write({ type: `insert`, value })
            return params.commit()
          }
          startScopedRecovery = () => {
            const start = params.metadata?.persistence?.startScopedRecovery
            if (!start) throw new Error(`the wrapper offers no scoped recovery`)
            return start()
          }
          remove = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `delete`, value })
            return params.commit()
          }
          update = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `update`, value })
            return params.commit()
          }
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              upstream.calls.push(options)
              upstream.arrivedAt.set(options, Date.now())
              upstream.visibleAtCall.push(
                collection.toArray.map((row) => row.id).sort(),
              )
              if (upstream.rejectAtOnce) {
                upstream.events.push({ type: `failed`, load: options })
                return Promise.reject(new Error(`offline at once`))
              }
              const loaded = new Promise<void>((resolve, reject) => {
                pending.push({ resolve, reject, options, epoch })
              })
              if (upstream.truncateInNextLoad) {
                upstream.truncateInNextLoad = false
                epoch++
                void truncate?.()
                upstream.events.push({ type: `truncate` })
              }
              return loaded
            },
          }
        },
      },
    }),
  )
  return { collection, upstream }
}

export function filterQuery(
  source: Collection<Row, string, any>,
  group: string,
) {
  return createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, group)),
  )
}

export function trackPreload(query: Collection<any, any, any>) {
  const state = { value: `pending` as `pending` | `resolved` | `rejected` }
  void query.preload().then(
    () => (state.value = `resolved`),
    () => (state.value = `rejected`),
  )
  return () => state.value
}

export async function untilUpstreamCalled(upstream: Upstream, count = 1) {
  for (let i = 0; i < 200 && upstream.calls.length < count; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await realMacrotask()
  }
  if (upstream.calls.length < count) {
    throw new Error(
      `checkpoint not reached: upstream load ${count} never started`,
    )
  }
}

export function quietConsole(): void {
  vi.spyOn(console, `warn`).mockImplementation(() => {})
  vi.spyOn(console, `error`).mockImplementation(() => {})
}
