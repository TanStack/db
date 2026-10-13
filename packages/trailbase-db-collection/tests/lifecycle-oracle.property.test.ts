import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { MockRecordApi } from './mock-record-api'
import type { Event, ListResponse } from 'trailbase'

/**
 * # Does a TrailBase sync run publish and retire one valid row history?
 *
 * An eager sync run needs both its list and stream before readiness. An
 * on-demand sync run does not claim an initial list. Stream events update an independent
 * key/value relation. Startup failure rejects; later failure keeps the last
 * rows and reports the error. Cleanup clears rows, cancels work, and fences
 * late results from prior sync runs after restart.
 *
 * A controlled RecordApi and native ReadableStream provide explicit gates for
 * subscribe, list, events, closure, parse failure, cancellation, and cleanup.
 * The same interpreter runs a fixed boundary corpus and generated one-to-three
 * sync-run histories. It compares rows, readiness, exact reports, reader locks,
 * timers, cancellations, and detached rejections after every step.
 *
 * See `ORACLE.md` for the full domain, replay commands, mutation evidence, and
 * the boundary intentionally left to service-backed tests.
 */

type Row = { id: number; value: number }
type Change = { operation: `set` | `delete`; id: number; value: number }
type Ending =
  `close` | `buffered-close` | `read-error` | `parse-error` | `cleanup`
// Each plan represents one Collection sync run and its controlled RecordApi
// work; subscription can fail before a TrailBase provider stream exists.
type SyncRunPlan =
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
type Scenario = {
  mode: `eager` | `on-demand`
  syncRuns: Array<SyncRunPlan>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  // Every adapter promise is observed even when its sync run is abandoned.
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
  { mode, syncRuns }: Scenario,
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
    for (const [epoch, plan] of syncRuns.entries()) {
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
const syncRunArb: fc.Arbitrary<SyncRunPlan> = fc.oneof(
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
  syncRuns: fc.array(syncRunArb, {
    minLength: 1,
    maxLength: 3,
  }),
})
const live = (ending: Ending, immediate = false): SyncRunPlan => ({
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
const corpus: Array<{
  name: string
  syncRuns: Array<SyncRunPlan>
}> = [
  ...(
    [`close`, `buffered-close`, `read-error`, `parse-error`, `cleanup`] as const
  ).flatMap((ending) =>
    [false, true].map((immediate) => ({
      name: `${ending}, immediate=${immediate}`,
      syncRuns: [live(ending, immediate)],
    })),
  ),
  ...([`cancel-subscribe`, `cancel-load`] as const).flatMap((kind) =>
    ([`resolve`, `reject`] as const).map((late) => ({
      name: `${kind}, stale ${late} after restart`,
      syncRuns: [{ kind, late }, live(`close`)],
    })),
  ),
  ...([`reject-subscribe`, `reject-load`] as const).map((kind) => ({
    name: kind,
    syncRuns: [{ kind }, live(`close`)],
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
)(`preserves lifecycle laws: $mode / $name`, ({ mode, syncRuns }) =>
  checkLifecycle({ mode, syncRuns }),
)
it.each([`eager`, `on-demand`] as const)(
  `releases a late acquired stream even when native cancellation rejects: %s`,
  (mode) =>
    checkLifecycle({
      mode,
      syncRuns: [
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
      syncRuns: [live(`buffered-close`)],
    }
    await checkLifecycle(scenario)
    await expect(checkLifecycle(scenario, cut)).rejects.toMatchObject({
      name: `AssertionError`,
      message: expect.stringContaining(`deeply equal`),
    })
  },
)
fcTest.prop([scenarioArb], { seed: 714_203, numRuns: oracleRuns(50) })(
  `matches generated lifecycle histories with a fixed seed`,
  (scenario) => checkLifecycle(scenario),
)
fcTest.prop([scenarioArb], oraclePropertyOptions(50, `trailbase.lifecycle`))(
  `matches generated lifecycle histories with a random or replayed seed`,
  (scenario) => checkLifecycle(scenario),
)

/**
 * ## Does an early on-demand load wait for the change listener?
 *
 * Law: an on-demand load that arrives before the change listener runs must not
 * fetch until `start` reports that the listener runs or cannot start. Since
 * #2115 a live query is ready when its subset load settles, so this ordering
 * is what keeps readiness after the subscription and keeps a change that the
 * service commits before the subscription. The wait still answers its caller:
 * an abort rejects it with `AbortError`, cleanup ends it quietly, and a listener
 * that cannot start rejects it with that failure instead of fetching.
 *
 * Reference: a small service holds rows by key. `list` answers from the rows
 * at the moment it is called; a change reaches only the subscriptions that
 * exist when the change commits. The model predicts the list calls, the load
 * or query outcome, and the rows at first ready from the plan alone. It never
 * reads adapter state.
 *
 * Grammar (exhaustive, 16 histories): the subscription outcome is `listen`,
 * `subscribe-rejects`, `reader-fails` (the resolved stream is already locked),
 * `abort`, or `cleanup`; a service change before the subscription is present
 * or absent; the consumer is a real live query over the source, or the core
 * subset boundary with an abort signal. `abort` and `cleanup` use the subset
 * boundary, because a live query does not expose its demand's settlement.
 *
 * Checkpoints: after the demand is issued, after the service change, after the
 * subscription outcome, and, for `listen`, after a later change through the
 * listener. Each compares list calls, load or query state, collection status,
 * first-ready rows, and current rows.
 */
type EarlyRow = { id: number; data: string }
type EarlyOutcome =
  `listen` | `subscribe-rejects` | `reader-fails` | `abort` | `cleanup`
type EarlyDemandPlan = {
  outcome: EarlyOutcome
  serviceChange: boolean
  consumer: `live-query` | `subset`
}

const earlyServiceRows: Array<EarlyRow> = [
  { id: 1, data: `visible` },
  { id: 2, data: `visible` },
]

// The rows the query's filter selects from a service snapshot.
const visibleIds = (rows: Iterable<EarlyRow>) =>
  [...rows]
    .filter((row) => row.data === `visible`)
    .map((row) => row.id)
    .sort((a, b) => a - b)

function expectedEarlyDemand(plan: EarlyDemandPlan) {
  const service = new Map(earlyServiceRows.map((row) => [row.id, row]))
  if (plan.serviceChange) service.set(1, { id: 1, data: `hidden` })
  const failed =
    plan.outcome === `subscribe-rejects` || plan.outcome === `reader-fails`
  return {
    // Nothing may fetch before the listener runs.
    waiting: { listCalls: 0, settled: false },
    afterOutcome: {
      listCalls: plan.outcome === `listen` ? 1 : 0,
      status:
        plan.outcome === `cleanup`
          ? `cleaned-up`
          : failed
            ? `error`
            : plan.outcome === `abort`
              ? `loading`
              : `ready`,
      load:
        plan.outcome === `listen` || plan.outcome === `cleanup`
          ? `fulfilled`
          : `rejected`,
      abortError: plan.outcome === `abort`,
      // The list runs after the subscription, so it sees the service change.
      firstReadyRows:
        plan.outcome === `listen` ? visibleIds(service.values()) : undefined,
    },
    // A later change reaches the established listener.
    afterLaterChange:
      plan.outcome === `listen`
        ? visibleIds(
            [...service.values()].map((row) =>
              row.id === 2 ? { id: 2, data: `hidden` } : row,
            ),
          )
        : undefined,
  }
}

async function checkEarlyDemand(plan: EarlyDemandPlan) {
  const expected = expectedEarlyDemand(plan)
  const service = new Map(earlyServiceRows.map((row) => [row.id, row]))
  const listeners: Array<WritableStreamDefaultWriter<Event>> = []
  const subscription = deferred<ReadableStream<Event>>()
  let listCalls = 0
  const api = new MockRecordApi<EarlyRow>()
  api.subscribe.mockImplementation(() => subscription.promise)
  api.list.mockImplementation(() => {
    listCalls++
    return Promise.resolve({ records: [...service.values()] })
  })
  const commit = (row: EarlyRow) => {
    service.set(row.id, row)
    for (const writer of listeners) void writer.write({ Update: row })
  }
  const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
  const collection = createCollection(
    trailBaseCollectionOptions({
      recordApi: api,
      getKey: (row: EarlyRow) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      parse: {},
      serialize: {},
    }),
  )
  const query =
    plan.consumer === `live-query`
      ? createLiveQueryCollection((q) =>
          q
            .from({ row: collection })
            .where(({ row }) => eq(row.data, `visible`)),
        )
      : undefined
  let firstReadyRows: Array<number> | undefined
  query?.onFirstReady(() => {
    firstReadyRows = query.toArray.map((row) => row.id).sort((a, b) => a - b)
  })
  const controller = new AbortController()
  const consumer = observe(
    query
      ? query.preload()
      : Promise.resolve(
          collection._sync.loadSubset({ signal: controller.signal } as never),
        ),
  )
  const state = () =>
    consumer.result === `pending`
      ? { listCalls, settled: false }
      : { listCalls, settled: true }
  const trace = JSON.stringify(plan)

  try {
    await turn()
    expect(state(), `${trace} waiting`).toEqual(expected.waiting)
    if (plan.serviceChange) {
      commit({ id: 1, data: `hidden` })
      await turn()
      expect(state(), `${trace} after service change`).toEqual(expected.waiting)
    }

    if (plan.outcome === `listen`) {
      const stream = new TransformStream<Event>()
      listeners.push(stream.writable.getWriter())
      subscription.resolve(stream.readable)
    } else if (plan.outcome === `subscribe-rejects`) {
      subscription.reject(failure)
    } else if (plan.outcome === `reader-fails`) {
      const locked = new TransformStream<Event>().readable
      locked.getReader()
      subscription.resolve(locked)
    } else if (plan.outcome === `abort`) {
      controller.abort()
    } else {
      await collection.cleanup()
    }
    await turn()
    await turn()

    const after = expected.afterOutcome
    expect(listCalls, `${trace} list calls`).toBe(after.listCalls)
    expect(collection.status, `${trace} status`).toBe(after.status)
    if (query) {
      expect(consumer.result, `${trace} query preload`).toBe(after.load)
      expect(firstReadyRows, `${trace} first-ready rows`).toEqual(
        after.firstReadyRows,
      )
    } else {
      expect(consumer.result, `${trace} load`).toBe(after.load)
      if (after.abortError)
        expect(consumer.error, `${trace} abort`).toMatchObject({
          name: `AbortError`,
        })
      else if (after.load === `rejected`)
        expect(consumer.error, `${trace} failure`).toBeDefined()
    }

    if (expected.afterLaterChange && query) {
      commit({ id: 2, data: `hidden` })
      await turn()
      expect(
        query.toArray.map((row) => row.id).sort((a, b) => a - b),
        `${trace} after a later change`,
      ).toEqual(expected.afterLaterChange)
    }

    // Late subscription work after abort or cleanup must not fetch.
    if (plan.outcome === `abort` || plan.outcome === `cleanup`) {
      subscription.resolve(new TransformStream<Event>().readable)
      await turn()
      expect(listCalls, `${trace} late list calls`).toBe(0)
    }
  } finally {
    subscription.resolve(new TransformStream<Event>().readable)
    await query?.cleanup()
    await collection.cleanup()
    for (const writer of listeners) void writer.close().catch(() => undefined)
    await turn()
    reported.mockRestore()
  }
}

const earlyDemandPlans: Array<EarlyDemandPlan> = (
  [`listen`, `subscribe-rejects`, `reader-fails`, `abort`, `cleanup`] as const
).flatMap((outcome) =>
  [false, true].flatMap((serviceChange) =>
    (outcome === `abort` || outcome === `cleanup`
      ? ([`subset`] as const)
      : ([`live-query`, `subset`] as const)
    ).map((consumer) => ({ outcome, serviceChange, consumer })),
  ),
)

it.each(earlyDemandPlans)(
  `waits for the listener before an early on-demand fetch: $outcome / change=$serviceChange / $consumer`,
  (plan) => checkEarlyDemand(plan),
)

/**
 * ## Does a fetched page keep a newer change that the listener applied?
 *
 * Law: once a page and every change event for its rows have arrived, the
 * Collection's rows equal the service's rows. The listener runs before every
 * fetch, so a change that commits while a page is in flight reaches the
 * Collection as an event. The page was read before that change, so applying it
 * afterward must not return a changed row to its old value or bring a deleted
 * row back.
 *
 * Reference: a service holds rows by key. `list` captures a snapshot when it is
 * called and answers later, when the history releases it; a change commits to
 * the service and is delivered at once to the established listener. The model
 * predicts the Collection's rows from the service alone: after the page
 * settles they equal the service at that moment, and after every step they
 * equal it again. It never reads adapter state.
 *
 * Grammar (exhaustive, 15 histories): the mode is eager startup or an
 * on-demand load; the change updates an existing row, deletes it, or inserts a
 * new row; the change commits before the list call (on-demand only, since an
 * eager list starts as soon as the listener runs), while the page is in flight,
 * or after the page applies.
 *
 * Checkpoints: after the page settles, and after the change when it comes
 * last. Each compares the Collection's rows with the service.
 */
type RaceRow = { id: number; data: string }
type RacePlan = {
  mode: `eager` | `on-demand`
  change: `update` | `delete` | `insert`
  timing: `before-list` | `during-fetch` | `after-page`
}

const raceServiceRows: Array<RaceRow> = [
  { id: 1, data: `v1` },
  { id: 2, data: `v1` },
]

function raceChange(change: RacePlan[`change`]): {
  event: Event
  apply: (rows: Map<number, RaceRow>) => void
} {
  if (change === `update`) {
    const row = { id: 1, data: `v2` }
    return { event: { Update: row }, apply: (rows) => rows.set(1, row) }
  }
  if (change === `delete`) {
    const row = { id: 1, data: `v1` }
    return { event: { Delete: row }, apply: (rows) => rows.delete(1) }
  }
  const row = { id: 3, data: `v1` }
  return { event: { Insert: row }, apply: (rows) => rows.set(3, row) }
}

// Compare only the row fields; the Collection adds virtual properties.
const sortedRows = (rows: Iterable<RaceRow>) =>
  [...rows].map(({ id, data }) => ({ id, data })).sort((a, b) => a.id - b.id)

async function checkPageEventRace(plan: RacePlan) {
  const service = new Map(raceServiceRows.map((row) => [row.id, row]))
  const { event, apply } = raceChange(plan.change)
  const stream = new TransformStream<Event>()
  const listener = stream.writable.getWriter()
  const page = deferred<ListResponse<RaceRow>>()
  let snapshot: Array<RaceRow> | undefined
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() => Promise.resolve(stream.readable))
  api.list.mockImplementation(() => {
    snapshot = [...service.values()]
    return page.promise
  })
  const commitChange = async () => {
    apply(service)
    await listener.write(event)
    await turn()
  }
  const collection = createCollection(
    trailBaseCollectionOptions({
      recordApi: api,
      getKey: (row: RaceRow) => row.id,
      syncMode: plan.mode,
      startSync: true,
      parse: {},
      serialize: {},
    }),
  )
  const rows = () => sortedRows(collection.toArray)
  const trace = JSON.stringify(plan)

  try {
    await turn()
    if (plan.timing === `before-list`) await commitChange()
    const settled = observe(
      plan.mode === `eager`
        ? collection.preload()
        : Promise.resolve(collection._sync.loadSubset({})),
    )
    await turn()
    expect(snapshot, `${trace} list called`).toBeDefined()
    if (plan.timing === `during-fetch`) await commitChange()
    page.resolve({ records: snapshot! })
    await turn()
    await turn()
    expect(settled.result, `${trace} page settled`).toBe(`fulfilled`)
    expect(rows(), `${trace} rows after the page`).toEqual(
      sortedRows(service.values()),
    )

    if (plan.timing === `after-page`) {
      await commitChange()
      expect(rows(), `${trace} rows after the change`).toEqual(
        sortedRows(service.values()),
      )
    }
  } finally {
    page.resolve({ records: [] })
    await collection.cleanup()
    void listener.close().catch(() => undefined)
    await turn()
  }
}

const racePlans: Array<RacePlan> = ([`eager`, `on-demand`] as const).flatMap(
  (mode) =>
    ([`update`, `delete`, `insert`] as const).flatMap((change) =>
      (mode === `eager`
        ? ([`during-fetch`, `after-page`] as const)
        : ([`before-list`, `during-fetch`, `after-page`] as const)
      ).map((timing) => ({ mode, change, timing })),
    ),
)

it.each(racePlans)(
  `keeps a newer change over an older page: $mode / $change / $timing`,
  (plan) => checkPageEventRace(plan),
)

/**
 * ## What happens after the change stream ends?
 *
 * Law (the adapter's current contract, `ORACLE.md`): the adapter subscribes
 * once per sync run and does not resubscribe. After the stream ends, the
 * Collection keeps its rows and stays ready, a later service change does not
 * reach it, and a later on-demand load does not wait for a new subscription.
 * The load lists the service's current rows. This lane makes that limit
 * executable; it does not claim that the limit is the right product behavior.
 *
 * Reference: the same service model. The prediction after the stream ends is
 * the rows that the last delivered event or page established.
 *
 * Grammar (exhaustive, 2 histories): the stream closes gracefully or fails
 * with a read error after the first page applies; then the service changes a
 * row, and an on-demand load runs.
 *
 * Checkpoints: after the stream ends, after the service change, and after the
 * later load. Each compares rows, status, and subscribe calls.
 */
it.each([`close`, `read-error`] as const)(
  `keeps rows and does not resubscribe after the stream ends: %s`,
  async (ending) => {
    const service = new Map(raceServiceRows.map((row) => [row.id, row]))
    let controller!: ReadableStreamDefaultController<Event>
    const stream = new ReadableStream<Event>({
      start(value) {
        controller = value
      },
    })
    const api = new MockRecordApi<RaceRow>()
    api.subscribe.mockImplementation(() => Promise.resolve(stream))
    api.list.mockImplementation(() =>
      Promise.resolve({ records: [...service.values()] }),
    )
    const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: RaceRow) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        parse: {},
        serialize: {},
      }),
    )
    const rows = () => sortedRows(collection.toArray)

    try {
      await turn()
      await collection._sync.loadSubset({})
      await turn()
      const established = sortedRows(service.values())
      expect(rows(), `${ending} first page`).toEqual(established)

      if (ending === `close`) controller.close()
      else controller.error(failure)
      await turn()
      expect(collection.status, `${ending} status after the end`).toBe(`ready`)
      expect(rows(), `${ending} rows after the end`).toEqual(established)

      service.set(1, { id: 1, data: `v2` })
      await turn()
      expect(rows(), `${ending} a later change is not delivered`).toEqual(
        established,
      )

      await collection._sync.loadSubset({ limit: 10 } as never)
      await turn()
      expect(api.subscribe, `${ending} subscribe calls`).toHaveBeenCalledTimes(
        1,
      )
      expect(rows(), `${ending} a later load lists current rows`).toEqual(
        sortedRows(service.values()),
      )
    } finally {
      await collection.cleanup()
      reported.mockRestore()
    }
  },
)
