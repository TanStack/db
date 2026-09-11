import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { MockRecordApi } from './mock-record-api'
import type { Event, ListResponse } from 'trailbase'

type Row = { id: number; value: number }
type Change = { operation: `set` | `delete`; id: number; value: number }
type Ending =
  | `close`
  | `buffered-close`
  | `read-error`
  | `parse-error`
  | `cleanup`
type Session =
  | { kind: `cancel-subscribe`; late: `resolve` | `reject` }
  | { kind: `cancel-load`; late: `resolve` | `reject` }
  | { kind: `reject-subscribe` }
  | { kind: `reject-load` }
  | {
      kind: `stream`
      changes: Array<Change>
      ending: Ending
      immediate: boolean
    }
type Scenario = { mode: `eager` | `on-demand`; sessions: Array<Session> }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  // Every adapter promise is observed even when its session is abandoned.
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

function observe(promise: Promise<unknown>) {
  let result: `pending` | `fulfilled` | `rejected` = `pending`
  let error: unknown
  void promise.then(
    () => {
      result = `fulfilled`
    },
    (failure: unknown) => {
      result = `rejected`
      error = failure
    },
  )
  return {
    get result() {
      return result
    },
    get error() {
      return error
    },
  }
}

// All adapter I/O is gated. One host turn drains native stream microtasks and
// exposes detached rejections; it does not stand in for a network completion.
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const failure = new Error(`oracle stream failure`)
const invalidValue = -10_000

function source() {
  let controller!: ReadableStreamDefaultController<Event>
  const cancel = vi.fn((): void | Promise<void> => {})
  const stream = new ReadableStream<Event>({
    start(value) {
      controller = value
    },
    cancel,
  })
  return {
    stream,
    cancel,
    controller,
    subscription: deferred<ReadableStream<Event>>(),
    list: deferred<ListResponse<Row>>(),
    listCalls: 0,
  }
}

/**
 * Reference: rows are an independent key/value relation. Before readiness a
 * required load failure rejects startup; afterward a broken stream retains
 * the last rows and reports an error. Cleanup clears rows and retires work.
 * The model never reads adapter bookkeeping, pending transactions or caches.
 */
async function checkLifecycle({ mode, sessions }: Scenario) {
  const api = new MockRecordApi<Row>()
  let current = source()
  api.subscribe.mockImplementation(() => current.subscription.promise)
  api.list.mockImplementation(() => {
    current.listCalls++
    return current.list.promise
  })
  const allSources: Array<ReturnType<typeof source>> = []
  const retired: Array<() => void> = []
  const unhandled: Array<unknown> = []
  const onUnhandled = (error: unknown) => unhandled.push(error)
  const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
  const intervals = vi.spyOn(globalThis, `setInterval`)
  const cleared = vi.spyOn(globalThis, `clearInterval`)
  process.on(`unhandledRejection`, onUnhandled)
  const collection = createCollection(
    trailBaseCollectionOptions({
      recordApi: api,
      getKey: (row: Row) => row.id,
      syncMode: mode,
      parse: {
        value: (value) => {
          if (value === invalidValue) throw failure
          return value
        },
      },
      serialize: {},
    }),
  )
  let expected = new Map<number, Row>()
  const publicRows = () =>
    Array.from(collection.values(), ({ id, value }) => ({ id, value })).sort(
      (a, b) => a.id - b.id,
    )
  const assertRows = () =>
    expect(publicRows()).toEqual(
      [...expected.values()].sort((a, b) => a.id - b.id),
    )
  const assertNoTimers = () => {
    for (const timer of intervals.mock.results) {
      if (timer.type === `return`)
        expect(cleared).toHaveBeenCalledWith(timer.value)
    }
  }
  const flushRetired = async () => {
    retired.splice(0).forEach((settle) => settle())
    await turn()
    assertRows()
    expect(unhandled).toEqual([])
  }
  try {
    for (const [epoch, plan] of sessions.entries()) {
      current = source()
      const active = current
      allSources.push(active)
      expected = new Map()
      reported.mockClear()
      collection.startSyncImmediate()
      const preload = observe(collection.preload())
      await turn()
      expect(api.subscribe).toHaveBeenCalledTimes(epoch + 1)
      expect(collection.status).toBe(`loading`)
      expect(preload.result).toBe(`pending`)
      assertRows()

      if (plan.kind === `cancel-subscribe`) {
        await collection.cleanup()
        retired.push(() =>
          plan.late === `resolve`
            ? active.subscription.resolve(active.stream)
            : active.subscription.reject(failure),
        )
      } else if (plan.kind === `reject-subscribe`) {
        active.subscription.reject(failure)
        await turn()
        expect(preload.result).toBe(`rejected`)
        expect(preload.error).toBe(failure)
        expect(collection.status).toBe(`error`)
        expect(active.listCalls).toBe(0)
        await collection.cleanup()
      } else {
        active.subscription.resolve(active.stream)
        await turn()
        const load =
          mode === `eager`
            ? preload
            : observe(Promise.resolve(collection._sync.loadSubset({})))
        await turn()
        expect(active.listCalls).toBe(1)
        expect(load.result).toBe(`pending`)
        expect(preload.result).toBe(mode === `eager` ? `pending` : `fulfilled`)

        if (plan.kind === `cancel-load`) {
          await collection.cleanup()
          retired.push(() =>
            plan.late === `resolve`
              ? active.list.resolve({ records: [{ id: 99, value: epoch }] })
              : active.list.reject(failure),
          )
        } else if (plan.kind === `reject-load`) {
          active.list.reject(failure)
          await turn()
          expect(load.result).toBe(`rejected`)
          expect(load.error).toBe(failure)
          expect(collection.status).toBe(mode === `eager` ? `error` : `ready`)
          assertRows()
          await collection.cleanup()
        } else {
          const baseline = { id: 0, value: epoch }
          active.list.resolve({ records: [baseline] })
          expected.set(0, baseline)
          await turn()
          expect(load.result).toBe(`fulfilled`)
          expect(preload.result).toBe(`fulfilled`)
          expect(collection.status).toBe(`ready`)
          assertRows()

          // Old subscribe/list work finishes only once the replacement owns
          // a live stream and baseline, not merely after the old cleanup.
          await flushRetired()
          expect(active.stream.locked).toBe(true)
          expect(active.cancel).not.toHaveBeenCalled()

          for (const change of plan.changes) {
            const previous = expected.get(change.id)
            if (change.operation === `delete`) {
              if (!previous) continue // Only issue legal deletes from the model.
              active.controller.enqueue({ Delete: previous })
              expected.delete(change.id)
            } else {
              const row = { id: change.id, value: change.value }
              active.controller.enqueue(
                previous ? { Update: row } : { Insert: row },
              )
              expected.set(change.id, row)
            }
            await turn()
            assertRows()
            expect(collection.status).toBe(`ready`)
          }

          if (plan.ending === `buffered-close`) {
            for (const id of [10, 11]) {
              const row = { id, value: epoch }
              active.controller.enqueue({ Insert: row })
              expected.set(id, row)
            }
          }
          if (plan.ending === `close` || plan.ending === `buffered-close`)
            active.controller.close()
          if (plan.ending === `read-error`) active.controller.error(failure)
          if (plan.ending === `parse-error`)
            active.controller.enqueue({
              Insert: { id: 12, value: invalidValue },
            })
          if (plan.immediate || plan.ending === `cleanup`) {
            await collection.cleanup()
            expected.clear()
          }
          await turn()
          assertRows()
          expect(active.stream.locked).toBe(false)
          assertNoTimers()
          const isFailure =
            plan.ending === `read-error` || plan.ending === `parse-error`
          if (isFailure && !plan.immediate) {
            expect(reported).toHaveBeenCalledExactlyOnceWith(
              `TrailBase subscription failed`,
              failure,
            )
          } else expect(reported).not.toHaveBeenCalled()
          if (plan.ending === `cleanup` || plan.ending === `parse-error`)
            expect(active.cancel).toHaveBeenCalledOnce()
          if (!plan.immediate && plan.ending !== `cleanup`)
            expect(collection.status).toBe(`ready`)
          await collection.cleanup()
        }
      }
      expected.clear()
      await turn()
      assertRows()
      expect(collection.status).toBe(`cleaned-up`)
      expect(unhandled).toEqual([])
      assertNoTimers()
    }
    await flushRetired()
    for (const active of allSources) expect(active.stream.locked).toBe(false)
  } finally {
    await collection.cleanup()
    // Release all controlled gates even when a mutant fails an early assertion.
    for (const active of allSources) {
      active.subscription.resolve(active.stream)
      active.list.resolve({ records: [] })
    }
    await turn()
    process.off(`unhandledRejection`, onUnhandled)
    reported.mockRestore()
    intervals.mockRestore()
    cleared.mockRestore()
  }
}

const changeArb = fc.record({
  operation: fc.constantFrom<Change[`operation`]>(`set`, `delete`),
  id: fc.integer({ min: 0, max: 3 }),
  value: fc.integer({ min: -20, max: 20 }),
})
const sessionArb: fc.Arbitrary<Session> = fc.oneof(
  fc.record({
    kind: fc.constantFrom(`cancel-subscribe` as const, `cancel-load` as const),
    late: fc.constantFrom(`resolve` as const, `reject` as const),
  }),
  fc.record({
    kind: fc.constantFrom(`reject-subscribe` as const, `reject-load` as const),
  }),
  fc.record({
    kind: fc.constant(`stream` as const),
    changes: fc.array(changeArb, { maxLength: 8 }),
    ending: fc.constantFrom<Ending>(
      `close`,
      `buffered-close`,
      `read-error`,
      `parse-error`,
      `cleanup`,
    ),
    immediate: fc.boolean(),
  }),
)
const scenarioArb = fc.record({
  mode: fc.constantFrom(`eager` as const, `on-demand` as const),
  sessions: fc.array(sessionArb, { minLength: 1, maxLength: 3 }),
})
const live = (ending: Ending, immediate = false): Session => ({
  kind: `stream`,
  ending,
  immediate,
  changes: [
    { operation: `set`, id: 1, value: 3 },
    { operation: `set`, id: 1, value: 4 },
    { operation: `delete`, id: 1, value: 0 },
  ],
})

// Fixed witnesses ensure every lifecycle boundary is exercised, independently
// of the random distribution. The same interpreter runs corpus and fuzz cases.
const corpus: Array<{ name: string; sessions: Array<Session> }> = [
  ...(
    [`close`, `buffered-close`, `read-error`, `parse-error`, `cleanup`] as const
  ).flatMap((ending) =>
    [false, true].map((immediate) => ({
      name: `${ending}, immediate=${immediate}`,
      sessions: [live(ending, immediate)],
    })),
  ),
  ...([`cancel-subscribe`, `cancel-load`] as const).flatMap((kind) =>
    ([`resolve`, `reject`] as const).map((late) => ({
      name: `${kind}, stale ${late} after restart`,
      sessions: [{ kind, late }, live(`close`)],
    })),
  ),
  ...([`reject-subscribe`, `reject-load`] as const).map((kind) => ({
    name: kind,
    sessions: [{ kind }, live(`close`)],
  })),
]
it.each([`resolve`, `reject`] as const)(
  `rejects startup before stream cancellation can %s`,
  async (cancellation) => {
    const active = source()
    const cancelled = deferred<void>()
    active.cancel.mockImplementation(() => cancelled.promise)
    const api = new MockRecordApi<Row>()
    api.subscribe.mockResolvedValue(active.stream)
    api.list.mockImplementation(() => active.list.promise)
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: Row) => row.id,
        syncMode: `eager`,
        parse: {
          value: () => {
            throw failure
          },
        },
        serialize: {},
      }),
    )
    const preload = observe(collection.preload())
    try {
      await turn()
      expect(api.list).toHaveBeenCalledOnce()
      active.controller.enqueue({ Insert: { id: 1, value: invalidValue } })
      await turn()
      expect(active.cancel).toHaveBeenCalledOnce()
      // Cleanup I/O is still pending, but it cannot postpone the load error.
      expect(preload.result).toBe(`rejected`)
      expect(preload.error).toBe(failure)
      expect(collection.status).toBe(`error`)
      active.list.resolve({ records: [] })
      await turn()
      expect(preload.result).toBe(`rejected`)
      expect(collection.status).toBe(`error`)
    } finally {
      if (cancellation === `resolve`) cancelled.resolve()
      else cancelled.reject(new Error(`cancel failure`))
      active.list.resolve({ records: [] })
      await collection.cleanup()
      await turn()
    }
  },
)

it.each(
  corpus.flatMap((entry) =>
    ([`eager`, `on-demand`] as const).map((mode) => ({ ...entry, mode })),
  ),
)(`preserves lifecycle laws: $mode / $name`, ({ mode, sessions }) =>
  checkLifecycle({ mode, sessions }),
)
fcTest.prop([scenarioArb], { seed: 714_203, numRuns: oracleRuns(30) })(
  `matches generated lifecycle histories with a fixed seed`,
  checkLifecycle,
)
fcTest.prop([scenarioArb], oraclePropertyOptions(50, `trailbase.lifecycle`))(
  `matches generated lifecycle histories with a random or replayed seed`,
  checkLifecycle,
)
