/**
 * Actual Direct SDK receiving driver for persisted demand coverage. The shared
 * primary model in db-sqlite-persistence-core judges the recorded source facts,
 * exact requests, public readiness and durable row projections.
 *
 * HTTP checkpoint rows are authoritative source facts. An empty table delivered
 * synchronously by a newly constructed SDK is not a provider reset: it has not
 * received a checkpoint. Recording the adapter's own truncate as authority
 * would let an accidental cache reset erase the very obligation under test.
 * Successful/failed loads are recorded at Direct's actual loadSubset boundary,
 * after its applied receipt, rather than inferred from provider completion.
 * Aborted acquisitions retain their physical outcomes as diagnostics. Their
 * later rejections do not become active source failures, and only un-aborted
 * acquisitions contribute to the current query's readiness obligation. Limited
 * and tie-boundary acquisitions can remain current together.
 *
 * The applied input cut observes the SDK wait promises production actually
 * starts, their cancellation/release, issued applied receipts and actual
 * persistence operations, including adapters resolved by Collection or mode.
 * Four stable native task boundaries permit their finite continuations. The
 * cut never waits for expected rows, adapter load settlement or readiness.
 *
 * Each host closes storage and opens it again between sync runs. A fresh SDK
 * cannot supply rows from memory. A separate claim reads durable rows before
 * second-run adapter startup and at both public observation cuts. No production
 * metadata is installed or interpreted. Single-process coordination only.
 */
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  parseLoadSubsetOptions,
} from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { plainLoadSnapshot } from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { PowerSyncClient, powerSyncCollectionOptions } from '../src'
import { createDirectInputLedger } from './direct-input-receiving'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  CoverageRecord,
  FilterSpec,
  QueryObservation,
  SourceEvent,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type { DirectDemandHistory } from './persisted-demand-history-oracle'

type Row = { id: string; group: string; rank: number; value: string }
const rows: Array<Row> = [
  { id: `a1`, group: `a`, rank: 1, value: `saved-one` },
  { id: `a2`, group: `a`, rank: 2, value: `saved-two` },
  { id: `a3`, group: `a`, rank: 3, value: `saved-three` },
]
const turn = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, premise: string) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Unreached Direct demand premise: ${premise}`)
    await turn(5)
  }
}

class DemandService {
  requests = 0
  confirmed = false
  private operation = 0
  private stream?: ReadableStreamDefaultController<Uint8Array>
  private signal?: AbortSignal
  private subscriptions: Array<{ stream: string }> = []
  readonly fetch: typeof fetch = (_url, init) => {
    this.requests++
    this.subscriptions = JSON.parse(String(init?.body)).streams.subscriptions
    this.signal = init?.signal ?? undefined
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            start: (stream) => {
              this.stream = stream
              this.signal?.addEventListener(
                `abort`,
                () => {
                  try {
                    stream.close()
                  } catch {
                    /* Provider already closed. */
                  }
                },
                { once: true },
              )
            },
          },
          new CountQueuingStrategy({ highWaterMark: 0 }),
        ),
      ),
    )
  }
  get active() {
    return !!this.stream && !this.signal?.aborted
  }
  async checkpoint(
    next: ReadonlyArray<Row>,
    removed: ReadonlyArray<string> = [],
    reject = false,
  ) {
    await until(() => this.active, `real SDK opened controlled HTTP`)
    const requestRevision = this.requests
    const target = this.stream!
    const signal = this.signal
    if (!reject && this.subscriptions.length > 0) this.confirmed = true
    const last = String(this.operation + next.length + removed.length + 10)
    const line = (value: unknown) =>
      target.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
    line({
      checkpoint: {
        last_op_id: last,
        buckets: [{ bucket: `rows`, checksum: 0 }],
        streams: this.subscriptions.map((subscription, index) => ({
          name: subscription.stream,
          is_default: false,
          errors: reject
            ? [{ subscription: index, message: `offline demand` }]
            : [],
        })),
      },
    })
    const operations = [
      ...removed.map((id) => ({
        op: `REMOVE`,
        object_type: `rows`,
        object_id: id,
        op_id: String(++this.operation),
        checksum: 0,
      })),
      ...next.map(({ id, ...value }) => ({
        op: `PUT`,
        object_type: `rows`,
        object_id: id,
        data: JSON.stringify(value),
        op_id: String(++this.operation),
        checksum: 0,
      })),
    ]
    if (operations.length) line({ data: { bucket: `rows`, data: operations } })
    line({ checkpoint_complete: { last_op_id: last } })
    await until(
      () => signal?.aborted === true || target.desiredSize === 0,
      `SDK consumed checkpoint`,
    )
    return requestRevision
  }
}

export type DirectDemandSession = {
  persistence: PersistedCollectionPersistence
  close: () => unknown
}
export type DirectDemandCut = {
  name: string
  record: CoverageRecord
  durable: Array<Record<string, unknown>>
  preload: `pending` | `fulfilled` | `rejected`
  waits: Array<boolean>
  physical: Array<DirectPhysicalLoad>
  input?: ReturnType<ReturnType<typeof createDirectInputLedger>['snapshot']>
}
type DirectPhysicalLoad = {
  load: LoadSubsetOptions
  settlement: `pending` | `fulfilled` | `rejected`
  aborted: boolean
  error?: string
}
export type DirectDemandResult = {
  events: Array<SourceEvent>
  beforeStartupEvents: Array<SourceEvent>
  beforeStartup: Array<Record<string, unknown>>
  beforeStartupPhysical: Array<DirectPhysicalLoad>
  cuts: Array<DirectDemandCut>
  reached: Array<string>
  providerRequests: [number, number]
  resets: Array<{ session: number; confirmed: boolean }>
  cleanupErrors: Array<string>
  browserErrors?: ReadonlyArray<string>
}

/** Retain every teardown diagnostic and continue each session's cleanup. */
export async function recordDirectDemandCleanup(
  diagnostics: Array<string>,
  tasks: ReadonlyArray<() => unknown>,
): Promise<void> {
  for (const task of tasks)
    try {
      await task()
    } catch (error) {
      diagnostics.push(describeOracleCleanupError(error))
    }
}

/** Keep a completed comparison record when its receiving wrapper closes. */
export async function retainDirectDemandCleanup(
  record: () => Promise<DirectDemandResult>,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<DirectDemandResult> {
  let result: DirectDemandResult | undefined
  let failed = false
  let primary: unknown
  const secondary: Array<unknown> = []
  try {
    result = await record()
  } catch (error) {
    failed = true
    primary = error
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      if (result) result.cleanupErrors.push(describeOracleCleanupError(error))
      else secondary.push(error)
    }
  }
  if (failed) {
    if (secondary.length)
      throw new AggregateError(
        [primary, ...secondary],
        `Direct demand execution and cleanup failed`,
        { cause: primary },
      )
    throw primary
  }
  return result!
}

export async function durableRows(
  persistence: PersistedCollectionPersistence,
  id: string,
) {
  const adapter = persistence.adapter
  if (!adapter.claimCacheGeneration || !adapter.releaseCacheGenerationClaim)
    throw new Error(
      `Direct durable receiver requires real managed SQLite generations`,
    )
  const claim = await adapter.claimCacheGeneration(id)
  try {
    const snapshot = await adapter.loadResumeSnapshot(
      {
        kind: `managed`,
        storageCollectionId: claim.storageCollectionId,
        claimId: claim.claimId,
      },
      { includeRows: true },
    )
    return snapshot.rows
      .map((row) => ({ ...row.value, id: String(row.key) }))
      .sort((left, right) => left.id.localeCompare(right.id))
  } finally {
    await adapter.releaseCacheGenerationClaim(claim.claimId)
  }
}

export function source(
  persistence: PersistedCollectionPersistence,
  id: string,
  waitMs: number,
  events: Array<SourceEvent>,
  resets: DirectDemandResult['resets'],
  session: number,
  emptyMapper = false,
) {
  const service = new DemandService()
  const input = createDirectInputLedger()
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
    retryDelayMs: 1,
  })
  const sent: Array<LoadSubsetOptions> = []
  const starts: Array<number> = []
  const applied: Array<Promise<unknown>> = []
  const receipts: Array<{ pending: boolean; error?: unknown }> = []
  const physical: Array<{
    load: LoadSubsetOptions
    signal?: AbortSignal
    settlement: DirectPhysicalLoad['settlement']
    error?: string
  }> = []
  // Observe production's exact lease and waits; add no acquisition or wait.
  const acquireStreams = client.acquireStreams.bind(client)
  client.acquireStreams = (streams, leaseOptions) =>
    input.lease(acquireStreams(streams, leaseOptions))
  let markedReady = false
  let emptyMapperCalls = 0
  let finished = 0
  let resetEpoch = 0
  const options = powerSyncCollectionOptions<Row>({
    id,
    client,
    table: `rows`,
    parse: (row) => row as Row,
    getSubscriptions: (request) => {
      if (emptyMapper) {
        emptyMapperCalls++
        return []
      }
      const { filters } = parseLoadSubsetOptions(request)
      // A and B must be different provider scopes. Reusing one stream name
      // without parameters would make the paired omission histories ambiguous.
      return [
        {
          name: `rows`,
          parameters: {
            group:
              filters.find((filter) => filter.field[0] === `group`)?.value ??
              null,
            id:
              filters.find((filter) => filter.field[0] === `id`)?.value ?? null,
          },
        },
      ]
    },
  })
  const upstream = options.sync
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
      persistence: input.persistence(persistence),
      initialRender: { strategy: `network-first`, networkTimeoutMs: waitMs },
      sync: {
        ...upstream,
        sync: (params) => {
          events.push({ type: `sync run starts` })
          const handlers = upstream.sync({
            ...params,
            begin: (beginOptions) => {
              if (beginOptions?.snapshot) {
                resetEpoch++
                resets.push({ session, confirmed: service.confirmed })
              }
              params.begin(beginOptions)
            },
            truncate: (truncateOptions) => {
              resetEpoch++
              resets.push({ session, confirmed: service.confirmed })
              params.truncate(truncateOptions)
            },
            commit: (...args) => {
              const receipt = input.receipt(params.commit(...args))
              // Observe every issued receipt without deciding what rows it
              // should contain. The shared model judges omissions afterwards.
              applied.push(Promise.resolve(receipt))
              const state: (typeof receipts)[number] = { pending: true }
              receipts.push(state)
              void Promise.resolve(receipt).then(
                () => {
                  state.pending = false
                },
                (error: unknown) => {
                  state.pending = false
                  state.error = error
                },
              )
              return receipt
            },
            markReady: () => {
              markedReady = true
              params.markReady()
            },
          })
          if (
            !handlers ||
            typeof handlers === `function` ||
            !handlers.loadSubset
          )
            throw new Error(`Direct on-demand sync did not expose loadSubset`)
          const loadSubset = handlers.loadSubset
          return {
            ...handlers,
            loadSubset: (request: LoadSubsetOptions) => {
              // Keep request data, not the subscriber graph or live AbortSignal.
              // Those objects are not oracle observations and can carry functions.
              const load = plainLoadSnapshot({
                where: request.where,
                orderBy: request.orderBy,
                limit: request.limit,
                offset: request.offset,
                cursor: request.cursor,
                refetch: request.refetch,
              })
              sent.push(load)
              starts.push(Date.now())
              const attempt: (typeof physical)[number] = {
                load,
                signal: request.signal,
                settlement: `pending`,
              }
              physical.push(attempt)
              const receivedAtEpoch = resetEpoch
              return Promise.resolve(loadSubset(request)).then(
                () => {
                  attempt.settlement = `fulfilled`
                  finished++
                  events.push({
                    type: `settled`,
                    load,
                    current: receivedAtEpoch === resetEpoch,
                    aborted: request.signal?.aborted,
                  })
                },
                (error: unknown) => {
                  attempt.settlement = `rejected`
                  attempt.error = describeOracleCleanupError(error)
                  finished++
                  // Core owes no result for an aborted physical acquisition.
                  // Keep its rejection in diagnostics; it is not an active
                  // upstream failure in the primary coverage model.
                  if (!request.signal?.aborted)
                    events.push({ type: `failed`, load })
                  throw error
                },
              )
            },
          }
        },
      },
    }),
  )
  const receiveCommits = async () => {
    // Four task boundaries let finite SDK continuations issue their commits.
    // The observer then waits for actual receipts, never expected row values.
    for (let index = 0; index < 4; index++) await turn()
    await Promise.all([...applied])
  }
  return {
    collection,
    service,
    client,
    sent,
    starts,
    markedReady: () => markedReady,
    finished: () => finished,
    inputSnapshot: input.snapshot,
    mappedEmpty: () => emptyMapperCalls > 0,
    // A live query can own limited and tie-boundary work simultaneously.
    // Retain every currently owed acquisition, filtering only actual aborts;
    // an older un-aborted load never disappears merely because a newer starts.
    currentRequests: () =>
      physical
        .filter((attempt) => !attempt.signal?.aborted)
        .map(({ load }) => load),
    physical: () =>
      physical.map(({ signal, ...attempt }) => ({
        ...attempt,
        aborted: signal?.aborted === true,
      })),
    receiveCommits,
    checkpointAndApply: async (next: ReadonlyArray<Row>, reject = false) => {
      // A permitted replacement can replay the active demand and restart its
      // SDK connection. The provider answers that actual successor request with
      // the same authored rows, rather than waiting for expected query rows.
      await input.receive({
        requestRevision: () => service.requests,
        requestOpen: () => service.active,
        deliver: () => service.checkpoint(next, [], reject),
        additionalRevision: () => sent.length,
      })
      const failed = receipts.find((receipt) => receipt.error !== undefined)
      if (failed) throw failed.error
    },
  }
}

export type Source = ReturnType<typeof source>
function queryFor(
  current: Source,
  history: DirectDemandHistory,
  donor = false,
  second = false,
) {
  return createLiveQueryCollection((q) => {
    const filtered = q
      .from({ row: current.collection })
      .where(({ row }) =>
        donor
          ? eq(row.id, `a1`)
          : eq(
              row.group,
              second && history.transition?.startsWith(`load-other`)
                ? `b`
                : `a`,
            ),
      )
    return history.first.startsWith(`window`) && !donor
      ? filtered.orderBy(({ row }) => row.rank).limit(2)
      : filtered
  })
}
function observe(query: ReturnType<typeof queryFor>): QueryObservation {
  if (query.status === `ready`)
    return { status: `ready`, rows: query.toArray.map((row) => row.id) }
  if (query.status === `loading` || query.status === `error`)
    return { status: query.status }
  throw new Error(`Unexpected Direct receiving query status ${query.status}`)
}
export function directDemandSpec(history: DirectDemandHistory): FilterSpec {
  return {
    group: history.transition?.startsWith(`load-other`) ? `b` : `a`,
    ...(history.first.startsWith(`window`)
      ? { orderByRank: true, limit: 2 }
      : {}),
  }
}

/** Two closed SQLite connections and fresh SDKs, with public and durable cuts. */
export async function observeDirectPersistedDemand(
  history: DirectDemandHistory,
  id: string,
  open: () => DirectDemandSession | Promise<DirectDemandSession>,
): Promise<DirectDemandResult> {
  const events: Array<SourceEvent> = []
  const result: DirectDemandResult = {
    events,
    beforeStartupEvents: [],
    beforeStartup: [],
    beforeStartupPhysical: [],
    cuts: [],
    reached: [],
    providerRequests: [0, 0],
    resets: [],
    cleanupErrors: [],
  }
  const cleanup = (tasks: ReadonlyArray<() => unknown>) =>
    recordDirectDemandCleanup(result.cleanupErrors, tasks)
  const first = await open()
  const online = source(first.persistence, id, 0, events, result.resets, 1)
  const query = queryFor(online, history)
  const donor = queryFor(online, history, true)
  const answer = async (target: typeof query, next: ReadonlyArray<Row>) => {
    const from = online.sent.length
    void target.preload().catch(() => undefined)
    await until(
      () => online.sent.length > from && online.service.active,
      `authored first demand reached SDK HTTP`,
    )
    // Author rows once. Re-answering an actual successor transport is another
    // delivery of the same source fact, not another authored row change.
    events.push({
      type: `rows`,
      rows: next.map(({ id: key, ...value }) => [key, value]),
    })
    await online.checkpointAndApply(next)
    await turn(25)
    const received = new Set(online.sent.slice(from))
    return events.some(
      (event) =>
        event.type === `settled` &&
        received.has(event.load) &&
        event.current &&
        !event.aborted,
    )
  }
  try {
    if (history.first === `never`) await online.collection.preload()
    else if ([`overlap`, `incomplete`, `failed`].includes(history.first)) {
      if (await answer(donor, rows.slice(0, 1)))
        result.reached.push(`overlapping first load`)
      if (history.first !== `overlap`) {
        const requests = online.service.requests
        void query.preload().catch(() => undefined)
        await until(
          () =>
            online.sent.length >= 2 &&
            online.service.requests > requests &&
            online.service.active,
          `new exact demand after donor`,
        )
        if (history.first === `failed`) {
          const exact = new Set(online.currentRequests())
          await online.checkpointAndApply([], true)
          if (
            events.some(
              (event) => event.type === `failed` && exact.has(event.load),
            )
          )
            result.reached.push(`failed exact first load`)
        } else result.reached.push(`pending exact first load`)
      }
    } else {
      const complete = await answer(
        query,
        history.first === `empty`
          ? []
          : history.first.startsWith(`window`)
            ? rows
            : rows.slice(0, 2),
      )
      if (complete)
        result.reached.push(
          history.first === `empty`
            ? `completed empty first load`
            : `completed exact first load`,
        )
      if (history.first === `covered-overlap`) {
        if (await answer(donor, rows.slice(0, 2)))
          result.reached.push(`overlapping demands completed`)
      }
      if (history.first === `deleted` || history.first === `window-replaced`) {
        events.push({ type: `delete`, id: `a1` })
        const replacement: Array<Row> =
          history.first === `window-replaced`
            ? [{ id: `a15`, group: `a`, rank: 1.5, value: `replacement` }]
            : []
        if (replacement.length)
          events.push({
            type: `rows`,
            rows: replacement.map(({ id: key, ...value }) => [key, value]),
          })
        await online.service.checkpoint(replacement, [`a1`])
        await online.receiveCommits()
      }
    }
    await turn(25)
    result.beforeStartupPhysical = online.physical()
    result.providerRequests[0] = online.service.requests
  } finally {
    await cleanup([
      () => query.cleanup(),
      () => donor.cleanup(),
      () => online.collection.cleanup(),
      () => first.close(),
    ])
  }
  // Copy the completed source log before cleanup/second-run outcomes can alter
  // which exact first-run demands the primary model regards as covered.
  const firstEvents = [...events]
  result.beforeStartupEvents = firstEvents
  const second = await open()
  result.reached.push(`closed and reopened storage`)
  result.beforeStartup = await durableRows(second.persistence, id)
  const offline = source(
    second.persistence,
    id,
    history.waitMs,
    events,
    result.resets,
    2,
    history.second === `empty-mapper`,
  )
  const restored = queryFor(offline, history, false, true)
  let preload: DirectDemandCut['preload'] = `pending`
  try {
    void restored.preload().then(
      () => {
        preload = `fulfilled`
      },
      () => {
        preload = `rejected`
      },
    )
    await until(
      () => offline.sent.length > 0 && offline.service.active,
      `offline request reached real SDK HTTP`,
    )
    if (history.second === `empty-mapper`) {
      await offline.receiveCommits()
      if (offline.mappedEmpty())
        result.reached.push(`empty mapper after saved load`)
    }
    if (history.second === `rejected`) {
      await offline.checkpointAndApply([], true)
    }
    const take = async (name: string) => {
      const current = offline.currentRequests()
      const record: CoverageRecord = {
        events: [...events],
        queries: {
          demand: {
            spec: directDemandSpec(history),
            sent: current,
            observed: observe(restored),
          },
        },
        collection: {
          status: offline.collection.status,
          sourceMarkedReady: offline.markedReady(),
        },
        upstream:
          history.second === `rejected` ? `fails at once` : `never answers`,
        waitPassed: false,
      }
      // Materialize per-load waits for browser transport without reinterpreting
      // them later. Capture every public premise in this same task, before the
      // durable read can cross a deadline. Held-source durable rows stay fixed
      // during that read; only readiness can advance with the clock.
      const publicPreload = preload
      const waits = current.map(
        (load) =>
          Date.now() - offline.starts[offline.sent.indexOf(load)]! >=
          history.waitMs,
      )
      const physical = offline.physical()
      const receivingInput = offline.inputSnapshot()
      const readDurable = async () => {
        if (history.slowDurableRead && name === `before deadline`) {
          // This receiving control delays the durable observation after the
          // public cut. It checks the same model, without expected product rows.
          await turn(1100)
          if (
            !waits.some(
              (passed, index) =>
                !passed &&
                Date.now() -
                  offline.starts[offline.sent.indexOf(current[index]!)]! >=
                  history.waitMs,
            )
          )
            throw new Error(`Delayed durable observation missed the deadline`)
          result.reached.push(
            `durable observation crossed the public wait deadline`,
          )
        }
        return durableRows(second.persistence, id)
      }
      result.cuts.push({
        name,
        record,
        durable: await readDurable(),
        preload: publicPreload,
        waits,
        physical,
        input: receivingInput,
      })
    }
    await turn(history.waitMs === 1000 ? 100 : 25)
    await take(`before deadline`)
    if (history.second === `held` && history.waitMs > 0)
      await turn(history.first.startsWith(`window`) ? 2250 : 1150)
    else await turn(50)
    await take(`after deadline`)
    if (history.transition) {
      const refreshed: Array<Row> =
        history.transition === `refresh-exact`
          ? [{ id: `a2`, group: `a`, rank: 2, value: `fresh-two` }]
          : [{ id: `b1`, group: `b`, rank: 1, value: `fresh-other` }]
      // Direct's declared cache policy replaces the cache once a nonempty
      // stream lease has a successful checkpoint. This is cache eviction, not
      // evidence that rows outside the SDK's current table were remotely deleted.
      // A fresh SDK's initial empty listener has no such reset authority.
      events.push({
        type: `snapshot`,
        rows: refreshed.map(({ id: key, ...value }) => [key, value]),
      })
      await offline.checkpointAndApply(refreshed)
      result.reached.push(
        history.transition === `refresh-exact`
          ? `exact remote refresh omits a saved row`
          : `other demand checkpoint after saved load`,
      )
      await take(`after first remote checkpoint`)
    }
    result.providerRequests[1] = offline.service.requests
  } finally {
    await cleanup([
      () => restored.cleanup(),
      () => offline.collection.cleanup(),
      () => second.close(),
    ])
  }
  if (history.transition === `load-other-then-reject-saved`) {
    // A and the overlapping id demand both settled in the first run. The B
    // replacement ended that coverage. A third fresh SDK must not manufacture
    // successful offline A completeness from its now-empty durable result.
    const third = await open()
    const rejected = source(
      third.persistence,
      id,
      60_000,
      events,
      result.resets,
      3,
    )
    const prior = queryFor(rejected, { ...history, transition: undefined })
    let settlement: DirectDemandCut['preload'] = `pending`
    try {
      void prior.preload().then(
        () => {
          settlement = `fulfilled`
        },
        () => {
          settlement = `rejected`
        },
      )
      await until(
        () => rejected.sent.length > 0 && rejected.service.active,
        `saved demand reopened after cache eviction`,
      )
      await rejected.checkpointAndApply([], true)
      await turn(25)
      const publicSettlement = settlement
      const current = rejected.currentRequests()
      const waits = current.map(
        (load) =>
          Date.now() - rejected.starts[rejected.sent.indexOf(load)]! >= 60_000,
      )
      const physical = rejected.physical()
      result.cuts.push({
        name: `saved demand after cache eviction`,
        record: {
          events: [...events],
          queries: {
            demand: {
              spec: { group: `a` },
              sent: current,
              observed: observe(prior),
            },
          },
          collection: {
            status: rejected.collection.status,
            sourceMarkedReady: rejected.markedReady(),
          },
          upstream: `fails at once`,
          waitPassed: false,
        },
        durable: await durableRows(third.persistence, id),
        preload: publicSettlement,
        waits,
        physical,
      })
      result.reached.push(`saved demand failed after cache eviction`)
    } finally {
      await cleanup([
        () => prior.cleanup(),
        () => rejected.collection.cleanup(),
        () => third.close(),
      ])
    }
  }
  return result
}
