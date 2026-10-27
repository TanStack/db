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
 * key/value relation. Startup failure rejects; any later end of the stream
 * that the adapter did not cancel keeps the last rows and the `ready` status
 * and reports the Collection's `error`, because the adapter does not resubscribe.
 * A failure is that error's `cause`. Cleanup clears rows, cancels work, and fences
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
          if (!plan.immediate && plan.ending !== `cleanup`) {
            expect(
              collection.health,
              `${epoch}:${plan.ending} error`,
            ).toMatchObject({
              hasErrors: true,
              failureReason: null,
              error: expect.objectContaining(
                isFailure ? { cause: failure } : {},
              ),
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
 * Grammar (exhaustive, 28 histories): the mode is eager startup or an
 * on-demand load; the change updates an existing row, deletes it, inserts a
 * new row, or inserts a new row and then updates it; the change commits
 * before the list call (on-demand only, since an eager list starts as soon as
 * the listener runs), while the page is in flight, or after the page applies.
 * A change committed before the list call is part of the page's snapshot, but
 * its events can still be in transit: they reach the listener at once, while
 * the page is in flight, or only after the page applies.
 *
 * Checkpoints: after the page settles, and after the last event. Each
 * compares the Collection's rows with the service once every event for a row
 * has arrived. A later change to another row then checks that the listener
 * is still alive. An older event delivered after a newer page can show its
 * older value until the newer event that follows it arrives; the adapter has
 * no row version to order an event against a page, so the lane only checks a
 * row once all of its events have arrived.
 */
type RaceRow = { id: number; data: string }
type RacePlan = {
  mode: `eager` | `on-demand`
  change: `update` | `delete` | `insert` | `insert-then-update`
  timing: `before-list` | `during-fetch` | `after-page`
  // When a change committed before the list call reaches the listener.
  delivery?: `at-once` | `during-fetch` | `after-page`
}

const raceServiceRows: Array<RaceRow> = [
  { id: 1, data: `v1` },
  { id: 2, data: `v1` },
]

function raceChange(change: RacePlan[`change`]): {
  events: Array<Event>
  apply: (rows: Map<number, RaceRow>) => void
} {
  if (change === `update`) {
    const row = { id: 1, data: `v2` }
    return { events: [{ Update: row }], apply: (rows) => rows.set(1, row) }
  }
  if (change === `delete`) {
    const row = { id: 1, data: `v1` }
    return { events: [{ Delete: row }], apply: (rows) => rows.delete(1) }
  }
  const inserted = { id: 3, data: `v1` }
  if (change === `insert`)
    return {
      events: [{ Insert: inserted }],
      apply: (rows) => rows.set(3, inserted),
    }
  const updated = { id: 3, data: `v2` }
  return {
    events: [{ Insert: inserted }, { Update: updated }],
    apply: (rows) => rows.set(3, updated),
  }
}

// Compare only the row fields; the Collection adds virtual properties.
const sortedRows = (rows: Iterable<RaceRow>) =>
  [...rows].map(({ id, data }) => ({ id, data })).sort((a, b) => a.id - b.id)

async function checkPageEventRace(plan: RacePlan) {
  const service = new Map(raceServiceRows.map((row) => [row.id, row]))
  const { events, apply } = raceChange(plan.change)
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
  // A write rejects once the adapter has torn its stream down.
  let listenerGone = false
  const send = async (event: Event) => {
    await listener.write(event).catch(() => {
      listenerGone = true
    })
    await turn()
  }
  const deliverEvents = async () => {
    for (const event of events) await send(event)
  }
  const commitChange = async () => {
    apply(service)
    await deliverEvents()
  }
  const delivery = plan.timing === `before-list` ? plan.delivery : undefined
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
    if (plan.timing === `before-list`) {
      apply(service)
      if (delivery === `at-once`) await deliverEvents()
    }
    const settled = observe(
      plan.mode === `eager`
        ? collection.preload()
        : Promise.resolve(collection._sync.loadSubset({})),
    )
    await turn()
    expect(snapshot, `${trace} list called`).toBeDefined()
    if (plan.timing === `during-fetch`) await commitChange()
    if (delivery === `during-fetch`) await deliverEvents()
    page.resolve({ records: snapshot! })
    await turn()
    await turn()
    expect(settled.result, `${trace} page settled`).toBe(`fulfilled`)
    if (delivery !== `after-page`)
      expect(rows(), `${trace} rows after the page`).toEqual(
        sortedRows(service.values()),
      )

    if (plan.timing === `after-page`) await commitChange()
    if (delivery === `after-page`) await deliverEvents()
    expect(rows(), `${trace} rows after the last event`).toEqual(
      sortedRows(service.values()),
    )

    // The listener is still alive: a later change to another row arrives.
    const later = { id: 2, data: `later` }
    service.set(2, later)
    await send({ Update: later })
    expect(listenerGone, `${trace} listener torn down`).toBe(false)
    expect(rows(), `${trace} rows after a later change`).toEqual(
      sortedRows(service.values()),
    )
  } finally {
    page.resolve({ records: [] })
    await collection.cleanup()
    void listener.close().catch(() => undefined)
    await turn()
  }
}

const racePlans: Array<RacePlan> = ([`eager`, `on-demand`] as const).flatMap(
  (mode) =>
    ([`update`, `delete`, `insert`, `insert-then-update`] as const).flatMap(
      (change) =>
        (mode === `eager`
          ? ([`during-fetch`, `after-page`] as const)
          : ([`before-list`, `during-fetch`, `after-page`] as const)
        ).flatMap((timing): Array<RacePlan> =>
          timing === `before-list`
            ? ([`at-once`, `during-fetch`, `after-page`] as const).map(
                (delivery) => ({ mode, change, timing, delivery }),
              )
            : [{ mode, change, timing }],
        ),
    ),
)

it.each(racePlans)(
  `keeps a newer change over an older page: $mode / $change / $timing / $delivery`,
  (plan) => checkPageEventRace(plan),
)

/**
 * ## Does a page converge while a user mutation holds sync commits?
 *
 * Law: the same convergence law as above, and a page never fails a load for
 * an older event that core has accepted but not yet shown. A TrailBase
 * mutation handler waits for its own change event, so core holds every sync
 * commit while that mutation persists. An accepted event is then part of the
 * pending synced state but not of the visible rows.
 *
 * Reference: the service model above. A user mutation updates row 2; its
 * request and its own change event arrive only when the history releases them.
 * The prediction ignores the mutation's timing for the other rows: once every
 * page, event, and the mutation have settled, the Collection equals the
 * service, and the on-demand load is fulfilled.
 *
 * Grammar (exhaustive, 4 histories): a mutation persists during the page or
 * no mutation runs; the older event before the list call inserts a new row or
 * updates an existing one, and the page lists a newer value whose event is
 * still in transit.
 *
 * A first load establishes the service's base rows before the history starts.
 *
 * Checkpoints: after the page settles, the load is pending while the mutation
 * holds commits and fulfilled otherwise; it never rejects. After the newer
 * event and the mutation settle, the load is fulfilled and the rows equal the
 * service.
 */
type HeldPlan = {
  held: boolean
  change: `insert` | `update`
}

async function checkHeldPage(plan: HeldPlan) {
  const id = plan.change === `insert` ? 3 : 1
  const service = new Map(raceServiceRows.map((row) => [row.id, row]))
  const stream = new TransformStream<Event>()
  const listener = stream.writable.getWriter()
  const page = deferred<ListResponse<RaceRow>>()
  const userRequest = deferred<void>()
  let snapshot: Array<RaceRow> | undefined
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() => Promise.resolve(stream.readable))
  // The first list loads the base rows; the second is the page under test.
  let lists = 0
  api.list.mockImplementation(() => {
    if (lists++ === 0)
      return Promise.resolve({ records: [...service.values()] })
    snapshot = [...service.values()]
    return page.promise
  })
  api.update.mockImplementation(() => userRequest.promise)
  const deliver = async (event: Event) => {
    await listener.write(event)
    await turn()
  }
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
  const trace = JSON.stringify(plan)

  try {
    await turn()
    await collection._sync.loadSubset({})
    await turn()
    let mutation: ReturnType<typeof observe> | undefined
    if (plan.held) {
      mutation = observe(
        collection.update(2, (draft) => {
          draft.data = `local`
        }).isPersisted.promise,
      )
      await turn()
    }
    const older = { id, data: `older` }
    service.set(id, older)
    await deliver(
      plan.change === `insert` ? { Insert: older } : { Update: older },
    )
    const newer = { id, data: `newer` }
    service.set(id, newer)

    const settled = observe(Promise.resolve(collection._sync.loadSubset({})))
    await turn()
    expect(snapshot, `${trace} list called`).toBeDefined()
    page.resolve({ records: snapshot! })
    await turn()
    await turn()
    // Held commits apply only when the mutation settles, and a load waits
    // until its rows are visible. It must not fail in the meantime.
    expect(settled.result, `${trace} load after the page`).toBe(
      plan.held ? `pending` : `fulfilled`,
    )

    await deliver({ Update: newer })
    if (mutation) {
      const confirmed = { id: 2, data: `local` }
      service.set(2, confirmed)
      userRequest.resolve()
      await turn()
      await deliver({ Update: confirmed })
      await turn()
      expect(mutation.result, `${trace} mutation persisted`).toBe(`fulfilled`)
    }
    expect(settled.result, `${trace} load after everything settles`).toBe(
      `fulfilled`,
    )
    expect(rows(), `${trace} rows after everything settles`).toEqual(
      sortedRows(service.values()),
    )
  } finally {
    page.resolve({ records: [] })
    userRequest.resolve()
    await collection.cleanup()
    void listener.close().catch(() => undefined)
    await turn()
  }
}

const heldPlans: Array<HeldPlan> = [true, false].flatMap((held) =>
  ([`insert`, `update`] as const).map((change) => ({ held, change })),
)

it.each(heldPlans)(
  `converges while a mutation holds sync commits: held=$held / $change`,
  (plan) => checkHeldPage(plan),
)

/**
 * ## What happens after the change stream ends?
 *
 * Law (the adapter's current contract, `ORACLE.md`): the adapter subscribes
 * once per sync run and does not resubscribe. After the stream ends, the
 * Collection keeps its rows and stays ready, a later service change does not
 * reach it, and a later on-demand load does not wait for a new subscription.
 * The load lists the service's current rows. Because the sync adapter stops
 * receiving changes, it reports the Collection's `error`, so an application can
 * see that the rows can grow stale; only a reload or restart subscribes again. This
 * lane makes that limit executable; reconnecting is left to the TrailBase
 * provider, and the lane does not claim the limit is the right product
 * behavior.
 *
 * Reference: the same service model. The prediction after the stream ends is
 * the rows that the last delivered event or page established.
 *
 * Grammar (exhaustive, 2 histories): the stream closes gracefully or fails
 * with a read error after the first page applies; then the service changes a
 * row, and an on-demand load runs. The lane pins one stream end followed by
 * one change and one load. It does not cover several later loads, a page in
 * flight when the stream ends, or cleanup between them.
 *
 * Checkpoints: after the stream ends, after the service change, and after the
 * later load. Each compares rows, status, and subscribe calls. After the end,
 * The Collection's `error` stays, and nothing clears it in this sync run.
 */
it.each([`close`, `read-error`] as const)(
  `keeps rows, reports an error, and does not resubscribe after the stream ends: %s`,
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
      const stopped = {
        hasErrors: true,
        failureReason: null,
        error: expect.anything(),
      }
      expect(collection.health, `${ending} error after the end`).toMatchObject(
        stopped,
      )

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
      expect(collection.health, `${ending} error after the load`).toMatchObject(
        stopped,
      )
    } finally {
      await collection.cleanup()
      reported.mockRestore()
    }
  },
)

/**
 * ## Does a reload recover a failed startup?
 *
 * Law (the error surface's reload contract): `reload()` runs `sync` again
 * while the Collection still shows `error`. The new run's own outcome decides
 * the reload: a subscription that listens makes it ready and the reload
 * resolves; a subscription that rejects fails the reload, and the status stays
 * `error`. The adapter cannot read Collection status to learn whether this run
 * is ready, because status still shows the failed run.
 *
 * Grammar (exhaustive, 2 histories): the first subscription rejects; the
 * reload's subscription listens or rejects. Checkpoints: after the reload
 * settles (or a bounded wait), compare its outcome, status, and subscribe
 * calls.
 */
it.each([`listens`, `rejects`] as const)(
  `a reload after a failed startup settles when the new subscription %s`,
  async (outcome) => {
    const stream = new ReadableStream<Event>({ start() {} })
    const api = new MockRecordApi<RaceRow>()
    api.subscribe
      .mockImplementationOnce(() => Promise.reject(failure))
      .mockImplementationOnce(() =>
        outcome === `listens`
          ? Promise.resolve(stream)
          : Promise.reject(new Error(`reload subscription failed`)),
      )
    api.list.mockImplementation(() => Promise.resolve({ records: [] }))
    const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: RaceRow) => row.id,
        startSync: true,
        parse: {},
        serialize: {},
      }),
    )
    try {
      await collection.preload().catch(() => undefined)
      expect(collection.status).toBe(`error`)
      const settled = await Promise.race([
        collection.reload().then(
          () => `resolved`,
          () => `rejected`,
        ),
        new Promise((resolve) => setTimeout(() => resolve(`pending`), 500)),
      ])
      expect(settled).toBe(outcome === `listens` ? `resolved` : `rejected`)
      expect(collection.status).toBe(outcome === `listens` ? `ready` : `error`)
      expect(api.subscribe).toHaveBeenCalledTimes(2)
    } finally {
      await collection.cleanup()
      reported.mockRestore()
    }
  },
)

/**
 * ## Does a reload of a ready Collection end with the service's rows?
 *
 * Law (the reload contract, maintainer decision F19): a reload keeps the rows
 * on screen until it completes. The new run's writes apply on the kept rows,
 * and only a snapshot or the run's own truncate replaces them; a run that
 * sends neither completes the reload at its `markReady()`. Once the reload
 * settles, an eager Collection holds the service's current rows, so a row
 * the service deleted between the runs is gone.
 *
 * Reference: the service is a key/value relation that `list` reads at the
 * moment it is called, in key order, 256 rows to a page with a cursor. The
 * expected rows never come from the adapter.
 *
 * Grammar (exhaustive, 10 histories): the service holds 3 rows (one page)
 * or 258 rows (two pages); between the runs it changes nothing, updates row
 * 1, deletes row 2, or inserts a new row; or, while the reload's last page
 * is held, it inserts a new row that page does not list and the listener
 * delivers its `Insert` event (`insert-event`). Checkpoints: while the
 * reload's last page is held, every row the Collection showed before the
 * reload that the service still has is still shown, and the reload has not
 * settled; after the page is released, the reload resolves, the status is
 * `ready`, and the rows equal the service's.
 */
it.each(
  [3, 258].flatMap((size) =>
    ([`none`, `update`, `delete`, `insert`, `insert-event`] as const).map(
      (change) => ({
        size,
        change,
      }),
    ),
  ),
)(
  `a reload of a ready eager Collection over $size rows ends with the service's rows after a $change`,
  async ({ size, change }) => {
    const service = new Map<number, RaceRow>()
    for (let id = 1; id <= size; id++) service.set(id, { id, data: `v1` })
    const api = new MockRecordApi<RaceRow>()
    let listener: WritableStreamDefaultWriter<Event> | undefined
    api.subscribe.mockImplementation(() => {
      const stream = new TransformStream<Event>()
      listener = stream.writable.getWriter()
      return Promise.resolve(stream.readable)
    })
    let holdLastPage: Promise<void> | undefined
    api.list.mockImplementation(async (options) => {
      const after = Number(options?.pagination?.cursor ?? 0)
      const records = [...service.values()]
        .sort((a, b) => a.id - b.id)
        .filter((row) => row.id > after)
        .slice(0, 256)
      if (records.length < 256) await holdLastPage
      return { records, cursor: String(records.at(-1)?.id ?? after) }
    })
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: RaceRow) => row.id,
        startSync: true,
        parse: {},
        serialize: {},
      }),
    )
    try {
      await collection.preload()
      const before = sortedRows(collection.toArray)
      expect(before).toEqual(sortedRows(service.values()))

      if (change === `update`) service.set(1, { id: 1, data: `v2` })
      else if (change === `delete`) service.delete(2)
      else if (change === `insert`)
        service.set(size + 1, { id: size + 1, data: `v1` })

      let releaseLastPage!: () => void
      holdLastPage = new Promise((resolve) => (releaseLastPage = resolve))
      const reload = observe(collection.reload())
      await turn()
      if (change === `insert-event`) {
        const row = { id: size + 1, data: `v1` }
        service.set(row.id, row)
        await listener!.write({ Insert: row })
        await turn()
      }
      const shown = new Set(collection.toArray.map((row) => row.id))
      expect(
        before.filter((row) => service.has(row.id) && !shown.has(row.id)),
        `kept rows the service still has stay while the reload runs`,
      ).toEqual([])
      expect(reload.result).toBe(`pending`)

      releaseLastPage()
      for (let i = 0; i < 5 && reload.result === `pending`; i++) await turn()
      expect(reload.result).toBe(`fulfilled`)
      expect(collection.status).toBe(`ready`)
      expect(sortedRows(collection.toArray)).toEqual(
        sortedRows(service.values()),
      )
    } finally {
      await collection.cleanup()
    }
  },
)

/**
 * ## Does an unchanged row survive an on-demand reload?
 *
 * Law (maintainer decisions F19 and snapshot-api §7): an on-demand reload
 * keeps the rows; core replays the live query's demand through the new
 * run, and once every replay succeeds it sweeps each kept row the new run
 * did not write. So a page writes every row it returns, unchanged ones too.
 *
 * Reference: the same service as the eager reload lane. Between the runs
 * the service updates row 1 and deletes row 2 with no change event; row 3
 * is untouched. Checkpoint: once the reload settles and the replayed load
 * has applied, the rows equal the service's, so row 3 survives, row 1
 * shows its edit, and row 2 is gone.
 */
it(`an unchanged row survives an on-demand reload`, async () => {
  const service = new Map<number, RaceRow>(
    [1, 2, 3].map((id) => [id, { id, data: `v1` }]),
  )
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() =>
    Promise.resolve(new ReadableStream<Event>({ start() {} })),
  )
  api.list.mockImplementation((options) => {
    const after = Number(options?.pagination?.cursor ?? 0)
    const records = [...service.values()]
      .sort((a, b) => a.id - b.id)
      .filter((row) => row.id > after)
      .slice(0, 256)
    return Promise.resolve({
      records,
      cursor: String(records.at(-1)?.id ?? after),
    })
  })
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
  const live = createLiveQueryCollection({
    query: (q) => q.from({ row: collection }),
  })
  try {
    await live.preload()
    expect(sortedRows(collection.toArray)).toEqual(sortedRows(service.values()))

    service.set(1, { id: 1, data: `v2` })
    service.delete(2)
    await collection.reload()
    await vi.waitFor(() =>
      expect(sortedRows(collection.toArray)).toEqual(
        sortedRows(service.values()),
      ),
    )
    expect(collection.status).toBe(`ready`)
  } finally {
    await live.cleanup()
    await collection.cleanup()
  }
})

/**
 * ## Do several pages, several changes, and overlapping loads still converge?
 *
 * Law: the same one as the page-event lane. Once every page and every change
 * event for a row have arrived, the Collection holds the service's current
 * value for that row, or no row if the service deleted it. Between steps, a
 * row that a change event touched never returns to an older value.
 *
 * Reference: the service holds 258 rows, so a full load reads two pages of
 * 256. Each `list` call captures the service at the moment it is called and
 * answers only when the history releases it. With cursor paging, a page
 * returns the rows after the previous page's last key; with offset paging, it
 * returns rows by position from the requested offset. A change commits to the
 * service at once; its event reaches the established listener at once or
 * stays in transit until a later `deliver` step or the drain, in commit order.
 * A page can therefore apply a newer value before an older event arrives.
 * The model records
 * which keys the service returned and which keys changed, and predicts the
 * Collection from the service's current rows for those keys. It never reads
 * adapter state.
 *
 * Grammar (generated): one or two on-demand loads, the second starting at
 * once or after a step; cursor or offset paging; up to four changes among
 * page releases, each an insert, update, or delete of a key on the first
 * page, the second page, or a new key, delivered at once or later. Offset
 * paging takes updates only,
 * because an insert or delete between pages moves rows across a position
 * boundary at the service, not in the adapter. An eager load cannot overlap
 * an on-demand one: an eager source has no subset loader.
 *
 * Checkpoints: after every step, every changed key with no event in transit
 * holds the service's value; after the history drains (every page, then every
 * event in transit), every returned or changed key does, and a later change
 * still reaches the listener.
 */
type PagingMode = `cursor` | `offset`
type PageStep =
  | { kind: `release`; load: 0 | 1 }
  | {
      kind: `change`
      id: 1 | 258 | 300
      operation: `set` | `delete`
      delivery: `now` | `later`
    }
  | { kind: `deliver` }
  | { kind: `start-second` }
type PageHistory = {
  paging: PagingMode
  loads: 1 | 2
  secondAtOnce: boolean
  steps: Array<PageStep>
}

const pageServiceSize = 258

const pageHistoryArb: fc.Arbitrary<PageHistory> = fc
  .record({
    paging: fc.constantFrom<PagingMode>(`cursor`, `offset`),
    loads: fc.constantFrom<1 | 2>(1, 2),
    secondAtOnce: fc.boolean(),
    steps: fc.array(
      fc.oneof(
        fc.record({
          kind: fc.constant(`release` as const),
          load: fc.constantFrom<0 | 1>(0, 1),
        }),
        fc.record({
          kind: fc.constant(`change` as const),
          id: fc.constantFrom<1 | 258 | 300>(1, 258, 300),
          operation: fc.constantFrom<`set` | `delete`>(`set`, `delete`),
          delivery: fc.constantFrom<`now` | `later`>(`now`, `later`),
        }),
        fc.constant({ kind: `deliver` as const }),
        fc.constant({ kind: `start-second` as const }),
      ),
      { maxLength: 10 },
    ),
  })
  .map((history) => {
    let changes = 0
    return {
      ...history,
      steps: history.steps.filter((step) => {
        if (step.kind !== `change`) return true
        if (changes >= 4) return false
        // Offset paging: only updates of rows the service already holds.
        if (
          history.paging === `offset` &&
          (step.operation === `delete` || step.id === 300)
        )
          return false
        changes++
        return true
      }),
    }
  })

async function checkPageHistory(history: PageHistory) {
  const service = new Map<number, RaceRow>()
  for (let id = 1; id <= pageServiceSize; id++)
    service.set(id, { id, data: `v0` })
  const stream = new TransformStream<Event>()
  const listener = stream.writable.getWriter()
  // Each load's list calls, oldest first, with the answer captured at the call.
  type PendingPage = { answer: ListResponse<RaceRow>; resolve: () => void }
  const pending: [Array<PendingPage>, Array<PendingPage>] = [[], []]
  const returnedKeys = new Set<number>()
  const changedKeys = new Set<number>()
  // Events in transit, in commit order.
  const inTransit: Array<{ id: number; event: Event }> = []
  let listenerGone = false
  const send = async (event: Event) => {
    await listener.write(event).catch(() => {
      listenerGone = true
    })
    await turn()
  }
  let version = 0
  let loadOfNextCall: 0 | 1 = 0
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() => Promise.resolve(stream.readable))
  api.list.mockImplementation((opts) => {
    const rows = [...service.values()].sort((a, b) => a.id - b.id)
    const limit = opts?.pagination?.limit ?? 256
    const after =
      opts?.pagination?.cursor === undefined
        ? undefined
        : Number(opts.pagination.cursor)
    const from =
      after !== undefined
        ? rows.findIndex((row) => row.id > after)
        : (opts?.pagination?.offset ?? 0)
    const records =
      from < 0 ? [] : rows.slice(from, from + limit).map((row) => ({ ...row }))
    const page = deferred<ListResponse<RaceRow>>()
    const answer = {
      records,
      cursor: records.length > 0 ? String(records.at(-1)!.id) : undefined,
    } as ListResponse<RaceRow>
    pending[loadOfNextCall].push({
      answer,
      resolve: () => {
        for (const record of records) returnedKeys.add(record.id)
        page.resolve(answer)
      },
    })
    return page.promise
  })
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
  const options =
    history.paging === `offset` ? ({ offset: 1 } as never) : ({} as never)
  const loads: Array<ReturnType<typeof observe>> = []
  const startLoad = async (load: 0 | 1) => {
    loadOfNextCall = load
    loads[load] = observe(Promise.resolve(collection._sync.loadSubset(options)))
    await turn()
  }
  const value = (id: number) => {
    const row = collection.get(id)
    return row ? { id: row.id, data: row.data } : undefined
  }
  const trace = JSON.stringify(history)
  const checkChangedKeys = (label: string) => {
    for (const id of changedKeys) {
      if (inTransit.some((pending) => pending.id === id)) continue
      expect(value(id), `${trace} ${label}: key ${id}`).toEqual(service.get(id))
    }
  }
  const deliverNext = async () => {
    const next = inTransit.shift()
    if (next) await send(next.event)
  }
  const release = async (load: 0 | 1) => {
    const next = pending[load].shift()
    if (!next) return
    loadOfNextCall = load
    next.resolve()
    await turn()
    await turn()
  }

  try {
    await turn()
    await startLoad(0)
    let secondStarted = false
    if (history.loads === 2 && history.secondAtOnce) {
      await startLoad(1)
      secondStarted = true
    }
    for (const [index, step] of history.steps.entries()) {
      if (step.kind === `release`) await release(step.load)
      else if (step.kind === `deliver`) await deliverNext()
      else if (step.kind === `start-second`) {
        if (history.loads === 2 && !secondStarted) {
          await startLoad(1)
          secondStarted = true
        }
      } else {
        const existing = service.get(step.id)
        let event: Event | undefined
        if (step.operation === `delete`) {
          if (existing) {
            service.delete(step.id)
            event = { Delete: existing }
          }
        } else {
          const row = { id: step.id, data: `v${++version}` }
          service.set(step.id, row)
          event = existing ? { Update: row } : { Insert: row }
        }
        if (event) {
          changedKeys.add(step.id)
          // Events keep commit order: a change behind one in transit waits.
          if (step.delivery === `later` || inTransit.length > 0)
            inTransit.push({ id: step.id, event })
          else await send(event)
        }
      }
      checkChangedKeys(`after step ${index}`)
    }
    if (history.loads === 2 && !secondStarted) await startLoad(1)

    // Drain: release every remaining page, oldest load first.
    for (let guard = 0; guard < 16; guard++) {
      if (pending[0].length === 0 && pending[1].length === 0) break
      await release(pending[0].length > 0 ? 0 : 1)
    }
    while (inTransit.length > 0) await deliverNext()
    for (const load of loads)
      expect(load.result, `${trace} load settled`).toBe(`fulfilled`)
    const reached = new Set([...returnedKeys, ...changedKeys])
    for (const id of reached)
      expect(value(id), `${trace} drained: key ${id}`).toEqual(service.get(id))
    // No other row exists: every visible key came from a page or an event.
    expect(
      [...collection.keys()].sort((a, b) => Number(a) - Number(b)),
      `${trace} drained: key set`,
    ).toEqual(
      [...reached].filter((id) => service.has(id)).sort((a, b) => a - b),
    )
    // The listener is still alive: a later change to an unrelated row arrives.
    const later = { id: 2, data: `later` }
    service.set(2, later)
    await send({ Update: later })
    expect(listenerGone, `${trace} listener torn down`).toBe(false)
    expect(value(2), `${trace} a later change arrives`).toEqual(later)
  } finally {
    for (const queue of pending)
      for (const next of queue.splice(0)) next.resolve()
    await collection.cleanup()
    void listener.close().catch(() => undefined)
    await turn()
  }
}

// Named replays: each closes one dimension the single-page lane leaves open.
const pageReplays: Array<[string, PageHistory]> = [
  [
    `an insert and its update in transit until after the page`,
    {
      paging: `cursor`,
      loads: 1,
      secondAtOnce: false,
      steps: [
        { kind: `change`, id: 300, operation: `set`, delivery: `later` },
        { kind: `change`, id: 300, operation: `set`, delivery: `later` },
        { kind: `release`, load: 0 },
        { kind: `release`, load: 0 },
        { kind: `deliver` },
        { kind: `deliver` },
      ],
    },
  ],
  [
    `an update between the two pages of one load`,
    {
      paging: `cursor`,
      loads: 1,
      secondAtOnce: false,
      steps: [
        { kind: `release`, load: 0 },
        { kind: `change`, id: 258, operation: `set`, delivery: `now` },
        { kind: `release`, load: 0 },
      ],
    },
  ],
  [
    `an update then a delete while the first page is in flight`,
    {
      paging: `cursor`,
      loads: 1,
      secondAtOnce: false,
      steps: [
        { kind: `change`, id: 1, operation: `set`, delivery: `now` },
        { kind: `change`, id: 1, operation: `delete`, delivery: `now` },
        { kind: `release`, load: 0 },
      ],
    },
  ],
  [
    `two overlapping loads around an update`,
    {
      paging: `cursor`,
      loads: 2,
      secondAtOnce: true,
      steps: [
        { kind: `change`, id: 1, operation: `set`, delivery: `now` },
        { kind: `release`, load: 1 },
        { kind: `release`, load: 0 },
      ],
    },
  ],
  [
    `offset paging with two updates between pages`,
    {
      paging: `offset`,
      loads: 1,
      secondAtOnce: false,
      steps: [
        { kind: `release`, load: 0 },
        { kind: `change`, id: 258, operation: `set`, delivery: `now` },
        { kind: `change`, id: 258, operation: `set`, delivery: `now` },
        { kind: `release`, load: 0 },
      ],
    },
  ],
]

it.each(pageReplays)(`converges: %s`, (_name, history) =>
  checkPageHistory(history),
)
fcTest.prop([pageHistoryArb], { seed: 205_917, numRuns: oracleRuns(40) })(
  `converges across generated page histories with a fixed seed`,
  (history) => checkPageHistory(history),
)
fcTest.prop(
  [pageHistoryArb],
  oraclePropertyOptions(40, `trailbase.page-event`),
)(
  `converges across generated page histories with a random or replayed seed`,
  (history) => checkPageHistory(history),
)

/**
 * ## Does a fresh sync run load a row an earlier run's event touched?
 *
 * Law: cleanup clears the Collection and retires the old run, so the new
 * run's page is the only source for that row until a new event arrives. The
 * page fence must compare against events of the current run only. A frozen
 * clock makes the old run's event and the new run's list call share a
 * millisecond, the case a wall-clock fence cannot order.
 */
it(`loads a row in a fresh run that an earlier run's event touched`, async () => {
  const service = new Map(raceServiceRows.map((row) => [row.id, row]))
  const streams: Array<WritableStreamDefaultWriter<Event>> = []
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() => {
    const stream = new TransformStream<Event>()
    streams.push(stream.writable.getWriter())
    return Promise.resolve(stream.readable)
  })
  api.list.mockImplementation(() =>
    Promise.resolve({
      records: [...service.values()].map((row) => ({ ...row })),
    }),
  )
  const now = vi.spyOn(Date, `now`).mockReturnValue(1_000_000)
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
  try {
    await turn()
    await collection._sync.loadSubset({})
    const changed = { id: 1, data: `v2` }
    service.set(1, changed)
    await streams[0]!.write({ Update: changed })
    await turn()
    expect(collection.get(1)?.data, `first run`).toBe(`v2`)

    await collection.cleanup()
    await collection.preload()
    await turn()
    await collection._sync.loadSubset({})
    await turn()
    expect(
      sortedRows(collection.toArray),
      `fresh run after an event in the same millisecond`,
    ).toEqual(sortedRows(service.values()))
  } finally {
    now.mockRestore()
    await collection.cleanup()
    for (const writer of streams) void writer.close().catch(() => undefined)
    await turn()
  }
})
