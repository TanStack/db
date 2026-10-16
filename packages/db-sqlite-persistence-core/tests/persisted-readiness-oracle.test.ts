import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src/index.js'
import type { PersistenceAdapter } from '../src/index.js'
import type { SyncConfig } from '@tanstack/db'

/**
 * # When does a persisted Collection open from restored rows?
 *
 * A persisted Collection keeps one status: `status` says whether the data can
 * be shown, wherever the rows came from. Without `initialRender`, the
 * Collection waits for its sync adapter, as any Collection does. With
 * `initialRender: { strategy: 'network-first', networkTimeoutMs }`, it prefers
 * the network for `networkTimeoutMs`. Once that deadline passes, or the remote
 * fails, a completed restore that installed rows opens the Collection: status
 * `ready` with the restored rows. Problems the remote reports after that are
 * the Collection's sync errors, and its rows stay.
 *
 * Three boundaries keep `ready` honest:
 *
 * - An empty restore never opens the Collection. It stays `loading` until the
 *   remote answers, so an empty list always means "no rows", not "unknown".
 *   (A Collection that synced to zero rows also waits for the network; the
 *   restore cannot tell the two apart.)
 * - The restore comes first. A remote that answers before the restore
 *   finishes waits for it, so remote rows apply over restored ones. A remote
 *   that became ready then makes the Collection `ready`. A remote that failed
 *   lets restored rows open the Collection, and the failure shows as its
 *   `error`; with no rows the first load fails (`status: 'error'`).
 * - A failed restore is a crash: local storage cannot serve reads.
 *
 * ## The model
 *
 * `expected` replays the events of one history over a small state: the
 * Collection's status, whether the restore finished and with how many rows,
 * whether the deadline passed, the remote answer that waits for the restore,
 * and the error the node shows. It reads no production state.
 *
 * ## The history grammar
 *
 * A history orders up to three events: the restore settles (with rows, empty,
 * or failed), the remote answers (it becomes ready, or it fails), and the
 * deadline passes. Every ordering of every combination is generated.
 *
 * ## The comparison
 *
 * After every event the driver compares the Collection's status, the message
 * of its node's `error`, and, while it is `ready`, the keys of its rows. A
 * live query over the Collection follows its status.
 *
 * ## Limits
 *
 * The adapter is a controlled in-memory persistence adapter, not native
 * SQLite. Restarts, cross-tab coordination, and on-demand persistence are
 * outside this owner (on-demand rejects network-first configuration).
 */

type Row = { id: string; value: string }
type Restore = `rows` | `empty` | `failed`
type Remote = `ready` | `fail`
type Event =
  | { kind: `restore`; outcome: Restore }
  | { kind: `remote`; outcome: Remote }
  | { kind: `deadline` }

const TIMEOUT = 100
const DISK_ROW: Row = { id: `disk`, value: `restored` }
const REMOTE_ROW: Row = { id: `remote`, value: `synced` }
const RESTORE_FAILURE = `restore failed`
const REMOTE_FAILURE = `remote gave up`

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

type Expected = {
  status: `loading` | `ready` | `error` | `crashed`
  error: string | null
  rows: Array<string>
}

function expected(events: ReadonlyArray<Event>): Array<Expected> {
  let status: Expected[`status`] = `loading`
  let restore: Restore | `pending` = `pending`
  let deadline = false
  let remoteFailed = false
  let waitingRemote: Remote | undefined
  let error: string | null = null
  const rows = new Set<string>()

  // Restored rows may open the Collection once the network had its chance.
  const openFromDisk = () => {
    if (
      status === `loading` &&
      restore === `rows` &&
      (deadline || remoteFailed)
    )
      status = `ready`
  }
  const applyRemoteReady = () => {
    rows.add(REMOTE_ROW.id)
    if (status === `loading`) status = `ready`
  }
  const applyRemoteFailure = () => {
    openFromDisk()
    if (status === `ready`) error = REMOTE_FAILURE
    else if (status === `loading`) {
      status = `error`
      error = REMOTE_FAILURE
    }
  }

  return events.map((event) => {
    if (status !== `crashed`) {
      if (event.kind === `restore`) {
        restore = event.outcome
        if (event.outcome === `failed`) {
          status = `crashed`
          error = RESTORE_FAILURE
        } else {
          if (event.outcome === `rows`) rows.add(DISK_ROW.id)
          if (waitingRemote === `ready`) applyRemoteReady()
          else if (waitingRemote === `fail`) applyRemoteFailure()
          else openFromDisk()
        }
      } else if (event.kind === `deadline`) {
        deadline = true
        openFromDisk()
      } else {
        if (event.outcome === `fail`) remoteFailed = true
        if (restore === `pending`) waitingRemote = event.outcome
        else if (event.outcome === `ready`) applyRemoteReady()
        else applyRemoteFailure()
      }
    }
    return {
      status,
      error,
      rows: status === `ready` ? [...rows].sort() : [],
    }
  })
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

function permutations<T>(items: ReadonlyArray<T>): Array<Array<T>> {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  )
}

const histories: Array<Array<Event>> = []
for (const restore of [`rows`, `empty`, `failed`] as const) {
  for (const remote of [`ready`, `fail`, undefined] as const) {
    for (const deadline of [true, false]) {
      const events: Array<Event> = [{ kind: `restore`, outcome: restore }]
      if (remote) events.push({ kind: `remote`, outcome: remote })
      if (deadline) events.push({ kind: `deadline` })
      histories.push(...permutations(events))
    }
  }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// A persistence adapter whose restore read waits for the history to settle it.
function controlledAdapter() {
  const load = deferred<ReadonlyArray<Row>>()
  void load.promise.catch(() => undefined)
  const adapter: PersistenceAdapter = {
    loadSubset: async () =>
      (await load.promise).map((value) => ({ key: value.id, value })),
    loadResumeSnapshot: async (_id, options) => {
      const rows = options?.includeRows === false ? [] : await load.promise
      return {
        rows: rows.map((value) => ({ key: value.id, value })),
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
    },
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, load }
}

function networkFirst(id: string, initialRender = true) {
  const fixture = controlledAdapter()
  let remote: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence: { adapter: fixture.adapter },
      ...(initialRender
        ? {
            initialRender: {
              strategy: `network-first` as const,
              networkTimeoutMs: TIMEOUT,
            },
          }
        : {}),
      sync: {
        sync: (params) => {
          remote = params
        },
      },
    }),
  )
  return {
    collection,
    restore: (outcome: Restore) =>
      outcome === `failed`
        ? fixture.load.reject(new Error(RESTORE_FAILURE))
        : fixture.load.resolve(outcome === `rows` ? [DISK_ROW] : []),
    remoteReady: () => {
      remote!.begin()
      remote!.write({ type: `insert`, value: REMOTE_ROW })
      remote!.commit()
      remote!.markReady()
    },
    remoteFail: () => remote!.fail(new Error(REMOTE_FAILURE)),
  }
}

function observe(collection: ReturnType<typeof networkFirst>[`collection`]) {
  return {
    status: collection.status,
    error: collection.errors.error?.message ?? null,
    rows:
      collection.status === `ready`
        ? collection.toArray.map((row) => row.id).sort()
        : [],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe(`persisted readiness oracle`, () => {
  it.each(histories.map((events) => [describe_(events), events] as const))(
    `%s`,
    async (_name, events) => {
      const source = networkFirst(`network-first-${describe_(events)}`)
      const live = createLiveQueryCollection((q) =>
        q.from({ row: source.collection }),
      )
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      try {
        void source.collection.preload().catch(() => undefined)
        void live.preload().catch(() => undefined)
        await vi.advanceTimersByTimeAsync(0)
        const model = expected(events)
        for (const [index, event] of events.entries()) {
          if (event.kind === `restore`) source.restore(event.outcome)
          else if (event.kind === `deadline`)
            await vi.advanceTimersByTimeAsync(TIMEOUT)
          else if (event.outcome === `ready`) source.remoteReady()
          else source.remoteFail()
          await vi.advanceTimersByTimeAsync(0)
          const label = `after ${describe_(events.slice(0, index + 1))}`
          expect(observe(source.collection), label).toEqual(model[index])
          // A live query over the Collection shows the same status, by
          // live-query readiness, until the Collection ends its first load.
          if (model[index]!.status !== `crashed`)
            expect(live.status, `${label}: live query`).toBe(
              model[index]!.status,
            )
        }
      } finally {
        consoleError.mockRestore()
        await live.cleanup()
        await source.collection.cleanup({ dependents: true })
      }
    },
  )

  it(`keeps a Collection without initialRender on the network boundary`, async () => {
    const source = networkFirst(`no-initial-render`, false)
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`rows`)
      await vi.advanceTimersByTimeAsync(TIMEOUT * 10)
      expect(source.collection.status).toBe(`loading`)
      source.remoteReady()
      await vi.advanceTimersByTimeAsync(0)
      expect(source.collection.status).toBe(`ready`)
    } finally {
      await source.collection.cleanup({ dependents: true })
    }
  })

  it(`defaults the network-first deadline to three seconds`, async () => {
    const fixture = controlledAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `default-network-deadline`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: { strategy: `network-first` },
        sync: { sync: () => {} },
      }),
    )
    try {
      void collection.preload().catch(() => undefined)
      fixture.load.resolve([DISK_ROW])
      await vi.advanceTimersByTimeAsync(2_999)
      expect(collection.status).toBe(`loading`)
      await vi.advanceTimersByTimeAsync(1)
      expect(collection.status).toBe(`ready`)
    } finally {
      await collection.cleanup({ dependents: true })
    }
  })

  it(`rejects network-first initial rendering for on-demand persistence`, () => {
    const fixture = controlledAdapter()
    expect(() =>
      persistedCollectionOptions<Row, string>({
        id: `local-on-demand`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        initialRender: { strategy: `network-first`, networkTimeoutMs: 100 },
        persistence: { adapter: fixture.adapter },
      }),
    ).toThrow(/network-first.*eager/i)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    `rejects an invalid network timeout (%s)`,
    (networkTimeoutMs) => {
      const fixture = controlledAdapter()
      expect(() =>
        persistedCollectionOptions<Row, string>({
          id: `invalid-network-deadline`,
          getKey: (row) => row.id,
          persistence: { adapter: fixture.adapter },
          initialRender: { strategy: `network-first`, networkTimeoutMs },
        }),
      ).toThrow(/networkTimeoutMs/)
    },
  )
})

function describe_(events: ReadonlyArray<Event>): string {
  return events
    .map((event) =>
      event.kind === `deadline` ? `deadline` : `${event.kind}:${event.outcome}`,
    )
    .join(` > `)
}
