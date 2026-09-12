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
  | {
      kind: `cancel-subscribe`
      late: `resolve` | `reject`
      cancelRejects?: boolean
    }
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
async function checkLifecycle(
  { mode, sessions }: Scenario,
  providerFault?: `list` | `set` | `buffered`,
) {
  const api = new MockRecordApi<Row>()
  let current = source()
  api.subscribe.mockImplementation(() => current.subscription.promise)
  api.list.mockImplementation(() => {
    current.listCalls++
    return current.list.promise
  })
  const allSources: Array<ReturnType<typeof source>> = []
  const retired: Array<() => void> = []
  const retiredChecks: Array<() => void> = []
  let observationEpoch = -1
  const unhandled: Array<{ epoch: number; error: unknown }> = []
  const reports: Array<{ epoch: number; args: Array<unknown> }> = []
  const expectedReports: typeof reports = []
  const reached: Array<string> = []
  const onUnhandled = (error: unknown) =>
    unhandled.push({ epoch: observationEpoch, error })
  const reported = vi.spyOn(console, `error`).mockImplementation((...args) => {
    reports.push({ epoch: observationEpoch, args })
  })
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
  // Model entries come only from command scalars. Provider objects may be
  // changed before parse without changing any expected row.
  const providerRow = (
    id: number,
    value: number,
    cut?: typeof providerFault,
  ) => {
    const row = { id, value }
    if (providerFault !== undefined && providerFault === cut) row.value += 1000
    return row
  }
  const publicRows = () =>
    Array.from(collection.values(), ({ id, value }) => ({ id, value })).sort(
      (a, b) => a.id - b.id,
    )
  const assertRows = () =>
    expect(publicRows(), JSON.stringify({ mode, reached })).toEqual(
      [...expected.values()].sort((a, b) => a.id - b.id),
    )
  const assertNoTimers = () => {
    for (const timer of intervals.mock.results) {
      if (timer.type === `return`)
        expect(cleared).toHaveBeenCalledWith(timer.value)
    }
  }
  const assertReports = () => {
    expect(reports).toEqual(expectedReports)
    expect(unhandled).toEqual([])
  }
  const flushRetired = async () => {
    retired.splice(0).forEach((settle) => settle())
    await turn()
    assertRows()
    retiredChecks.forEach((check) => check())
    assertReports()
  }
  const failures: Array<unknown> = []
  try {
    for (const [epoch, plan] of sessions.entries()) {
      current = source()
      const active = current
      allSources.push(active)
      expected = new Map()
      observationEpoch = epoch
      reached.push(`${epoch}:subscribe-pending`)
      collection.startSyncImmediate()
      const preload = observe(collection.preload())
      await turn()
      expect(api.subscribe).toHaveBeenCalledTimes(epoch + 1)
      expect(collection.status).toBe(`loading`)
      expect(preload.result).toBe(`pending`)
      assertRows()

      if (plan.kind === `cancel-subscribe`) {
        reached.push(`${epoch}:cancel-subscribe`)
        if (plan.cancelRejects)
          active.cancel.mockRejectedValue(new Error(`retired cancel failure`))
        await collection.cleanup()
        expect(preload.result).toBe(`rejected`)
        expect(preload.error).toMatchObject({ name: `AbortError` })
        const retiredError = preload.error
        retired.push(() =>
          plan.late === `resolve`
            ? active.subscription.resolve(active.stream)
            : active.subscription.reject(failure),
        )
        retiredChecks.push(() => {
          expect(preload.result).toBe(`rejected`)
          expect(preload.error).toBe(retiredError)
          expect(active.stream.locked).toBe(false)
          expect(active.cancel).toHaveBeenCalledTimes(
            plan.late === `resolve` ? 1 : 0,
          )
        })
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
        reached.push(`${epoch}:list-pending`)
        expect(load.result).toBe(`pending`)
        expect(preload.result).toBe(mode === `eager` ? `pending` : `fulfilled`)

        if (plan.kind === `cancel-load`) {
          reached.push(`${epoch}:cancel-load`)
          await collection.cleanup()
          expect(preload.result).toBe(
            mode === `eager` ? `rejected` : `fulfilled`,
          )
          if (mode === `eager`)
            expect(preload.error).toMatchObject({ name: `AbortError` })
          else expect(load.result).toBe(`pending`)
          const retiredError = preload.error
          retired.push(() =>
            plan.late === `resolve`
              ? active.list.resolve({ records: [{ id: 99, value: epoch }] })
              : active.list.reject(failure),
          )
          retiredChecks.push(() => {
            expect(preload.result).toBe(
              mode === `eager` ? `rejected` : `fulfilled`,
            )
            expect(preload.error).toBe(retiredError)
            // This is the adapter's direct subset promise, not an unfinished
            // initial preload: canceled I/O settles as a no-op after delivery.
            expect(load.result).toBe(
              mode === `eager` ? `rejected` : `fulfilled`,
            )
            expect(active.stream.locked).toBe(false)
            expect(active.cancel).toHaveBeenCalledOnce()
          })
        } else if (plan.kind === `reject-load`) {
          active.list.reject(failure)
          await turn()
          expect(load.result).toBe(`rejected`)
          expect(load.error).toBe(failure)
          expect(collection.status).toBe(mode === `eager` ? `error` : `ready`)
          assertRows()
          await collection.cleanup()
        } else {
          active.list.resolve({ records: [providerRow(0, epoch, `list`)] })
          expected.set(0, { id: 0, value: epoch })
          await turn()
          reached.push(`${epoch}:list-delivered`)
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
              active.controller.enqueue({
                Delete: providerRow(change.id, previous.value),
              })
              expected.delete(change.id)
            } else {
              const row = providerRow(change.id, change.value, `set`)
              active.controller.enqueue(
                previous ? { Update: row } : { Insert: row },
              )
              expected.set(change.id, { id: change.id, value: change.value })
            }
            await turn()
            reached.push(`${epoch}:${change.operation}:${change.id}`)
            assertRows()
            expect(collection.status).toBe(`ready`)
          }

          if (plan.ending === `buffered-close`) {
            for (const id of [10, 11]) {
              const row = providerRow(id, epoch, `buffered`)
              active.controller.enqueue({ Insert: row })
              expected.set(id, { id, value: epoch })
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
          reached.push(`${epoch}:${plan.ending}:immediate=${plan.immediate}`)
          assertRows()
          expect(active.stream.locked).toBe(false)
          assertNoTimers()
          const isFailure =
            plan.ending === `read-error` || plan.ending === `parse-error`
          if (isFailure && !plan.immediate) {
            expectedReports.push({
              epoch,
              args: [`TrailBase subscription failed`, failure],
            })
          }
          assertReports()
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
      assertReports()
      assertNoTimers()
    }
    await flushRetired()
    for (const active of allSources) expect(active.stream.locked).toBe(false)
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      await collection.cleanup()
    } catch (error) {
      failures.push(error)
    }
    // Release all controlled gates even when a mutant fails an early assertion.
    for (const active of allSources) {
      active.subscription.resolve(active.stream)
      active.list.resolve({ records: [] })
    }
    await turn()
    try {
      assertReports()
      assertNoTimers()
      for (const active of allSources) expect(active.stream.locked).toBe(false)
    } catch (error) {
      failures.push(error)
    }
    process.off(`unhandledRejection`, onUnhandled)
    reported.mockRestore()
    intervals.mockRestore()
    cleared.mockRestore()
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, `Lifecycle and cleanup checks failed`, {
      cause: failures[0],
    })
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
    const reports: Array<Array<unknown>> = []
    const unhandled: Array<unknown> = []
    const failures: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    const reported = vi
      .spyOn(console, `error`)
      .mockImplementation((...args) => {
        reports.push(args)
      })
    process.on(`unhandledRejection`, onUnhandled)
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
    } catch (error) {
      failures.push(error)
    } finally {
      if (cancellation === `resolve`) cancelled.resolve()
      else cancelled.reject(new Error(`cancel failure`))
      active.list.resolve({ records: [] })
      try {
        await collection.cleanup()
      } catch (error) {
        failures.push(error)
      }
      await turn()
      try {
        // Observe the final cancellation/list continuations before restoring
        // either recorder. Loading failure is reported through preload, not
        // console.error, and canceled transport errors must stay observed.
        expect(reports).toEqual([])
        expect(unhandled).toEqual([])
        expect(preload.result).toBe(`rejected`)
        expect(preload.error).toBe(failure)
        expect(active.stream.locked).toBe(false)
        expect(active.cancel).toHaveBeenCalledOnce()
        expect(collection.status).toBe(`cleaned-up`)
      } catch (error) {
        failures.push(error)
      } finally {
        process.off(`unhandledRejection`, onUnhandled)
        reported.mockRestore()
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, `Startup and cleanup checks failed`, {
        cause: failures[0],
      })
  },
)

it.each(
  corpus.flatMap((entry) =>
    ([`eager`, `on-demand`] as const).map((mode) => ({ ...entry, mode })),
  ),
)(`preserves lifecycle laws: $mode / $name`, ({ mode, sessions }) =>
  checkLifecycle({ mode, sessions }),
)
it.each([`eager`, `on-demand`] as const)(
  `releases a late acquired stream even when native cancellation rejects: %s`,
  (mode) =>
    checkLifecycle({
      mode,
      sessions: [
        { kind: `cancel-subscribe`, late: `resolve`, cancelRejects: true },
        live(`close`),
      ],
    }),
)
it.each([`list`, `set`, `buffered`] as const)(
  `rejects provider-owned row corruption at the %s cut`,
  async (cut) => {
    const scenario: Scenario = {
      mode: `eager`,
      sessions: [live(`buffered-close`)],
    }
    await checkLifecycle(scenario)
    await expect(checkLifecycle(scenario, cut)).rejects.toMatchObject({
      name: `AssertionError`,
      message: expect.stringContaining(`deeply equal`),
    })
  },
)
fcTest.prop([scenarioArb], { seed: 714_203, numRuns: oracleRuns(30) })(
  `matches generated lifecycle histories with a fixed seed`,
  (scenario) => checkLifecycle(scenario),
)
fcTest.prop([scenarioArb], oraclePropertyOptions(50, `trailbase.lifecycle`))(
  `matches generated lifecycle histories with a random or replayed seed`,
  (scenario) => checkLifecycle(scenario),
)
