/**
 * A neutral receiving recorder for persisted demand coverage. The primary
 * persistence model judges authored provider facts, exact physical requests,
 * public query observations and durable rows. Adapter-emitted startup truncates
 * are diagnostics, never authority for erasing a saved-demand obligation.
 *
 * Online construction deliberately waits for its first public preload: that
 * establishes the coverage premise, not the offline observation being judged.
 * Offline cuts drain responded SDK input, actual persistence operations and
 * issued receipts, with a bounded 100ms continuation allowance. They never
 * wait for query readiness or load settlement.
 * Public state is captured before the independent durable read. All timers
 * are measured per actual acquisition, including later tie-boundary loads.
 */
import { BTreeIndex, createLiveQueryCollection } from '@tanstack/db'
import { plainLoadSnapshot } from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import {
  retainOracleCleanupObservation,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  CoverageRecord,
  QueryObservation,
  SourceEvent,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type {
  DemandReceivingFactory,
  DemandReceivingSource,
  DemandRow,
} from './persisted-demand-receiving-types'

export type DemandReceivingHistory = {
  first: `covered` | `empty` | `never` | `overlap` | `pending` | `failed`
  second: `held` | `rejected`
  waitMs: number
  lateAnswer?: true | `changed values`
}
export type DemandReceivingSession = {
  persistence: PersistedCollectionPersistence
  close: () => unknown
}
type Attempt = {
  load: LoadSubsetOptions
  start: number
  sourceStart?: number
  settlement: `pending` | `fulfilled` | `rejected`
  signal?: AbortSignal
}
const requestData = (request: LoadSubsetOptions) =>
  plainLoadSnapshot({
    where: request.where,
    orderBy: request.orderBy,
    limit: request.limit,
    offset: request.offset,
    cursor: request.cursor,
    refetch: request.refetch,
  })
export type DemandReceivingCut = {
  name: string
  record: CoverageRecord
  waits: Array<boolean>
  preload: `pending` | `fulfilled` | `rejected`
  durable: Array<Record<string, unknown>>
  sourceWindow: Array<DemandRow>
  queryRows: Array<DemandRow> | undefined
  progress: Array<{
    admittedMsAgo: number
    sourceStartedMsAgo?: number
    settlement: Attempt['settlement']
  }>
  storage: { revision: number; pending: number; receipts: number }
}
export type DemandReceivingResult = {
  cuts: Array<DemandReceivingCut>
  beforeStartup: Array<Record<string, unknown>>
  beforeStartupEvents: Array<SourceEvent>
  reached: Array<string>
  requests: Array<number>
  startupResets: number
  cleanupErrors: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
}
const rows: ReadonlyArray<DemandRow> = [1, 2, 3, 4].map((rank) => ({
  id: `row-${rank}`,
  group: `a`,
  rank,
  value: `saved-${rank}`,
}))
const turn = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, premise: string) {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Unreached demand receiving premise: ${premise}`)
    await turn(2)
  }
}

/** Read through a separate managed claim; do not inspect coverage metadata. */
export async function readDemandDurableRows(
  persistence: PersistedCollectionPersistence,
  id: string,
): Promise<Array<Record<string, unknown>>> {
  const adapter = persistence.adapter
  if (!adapter.claimCacheGeneration || !adapter.releaseCacheGenerationClaim)
    throw new Error(`Demand receiver requires managed SQLite generations`)
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
      .sort((a, b) => a.id.localeCompare(b.id))
  } finally {
    await adapter.releaseCacheGenerationClaim(claim.claimId)
  }
}

function storageLedger(persistence: PersistedCollectionPersistence) {
  const pending = new Set<Promise<unknown>>()
  const failures: Array<unknown> = []
  let revision = 0
  const adapter = new Proxy(persistence.adapter, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target)
      if (typeof value !== `function`) return value
      return (...args: Array<unknown>) => {
        revision++
        const result: unknown = Reflect.apply(value, target, args)
        if (result instanceof Promise) {
          pending.add(result)
          void result.then(
            () => {
              pending.delete(result)
              revision++
            },
            (error: unknown) => {
              pending.delete(result)
              failures.push(error)
              revision++
            },
          )
        }
        return result
      }
    },
  })
  return {
    persistence: { ...persistence, adapter },
    diagnostic: (receipts: Set<Promise<unknown>>) => ({
      revision,
      pending: pending.size,
      receipts: receipts.size,
    }),
    async barrier(
      source: DemandReceivingSource,
      receipts: Set<Promise<unknown>>,
    ) {
      // A stable input interval drains admitted storage work and allows finite
      // wrapper/graph continuations between adapter calls. This is a bounded
      // observation cut, not a proof that every future task has run. No loop
      // condition reads expected rows, readiness or load settlement.
      for (let tries = 0; tries < 100; tries++) {
        await source.barrier()
        const before = revision
        await Promise.all([...pending, ...receipts])
        await turn(100)
        if (before === revision && pending.size === 0 && receipts.size === 0) {
          if (failures.length)
            throw new AggregateError(failures, `Receiving storage input failed`)
          return
        }
      }
      throw new Error(`Receiving input did not become quiescent`)
    },
  }
}

export async function observePersistedDemandReceiving(
  history: DemandReceivingHistory,
  id: string,
  factory: DemandReceivingFactory,
  open: () => Promise<DemandReceivingSession> | DemandReceivingSession,
): Promise<DemandReceivingResult> {
  const events: Array<SourceEvent> = []
  const cuts: Array<DemandReceivingCut> = []
  const reached = new Set<string>()
  const requests: Array<number> = []
  const cleanups: Array<() => unknown> = []
  let startupResets = 0
  let session = 0
  const closeAll = () =>
    withOracleCleanup(() => {}, cleanups.splice(0).reverse())

  const create = async () => {
    const host = await open()
    cleanups.push(host.close)
    const ledger = storageLedger(host.persistence)
    const attempts: Array<Attempt> = []
    const byRequest = new WeakMap<LoadSubsetOptions, Attempt>()
    // The primary model identifies current settlements by attempt identity.
    // Persistence forwards this request unchanged after hydration; both
    // observers must retain the same data snapshot for that one attempt.
    const snapshots = new WeakMap<LoadSubsetOptions, LoadSubsetOptions>()
    const snapshot = (request: LoadSubsetOptions) => {
      let load = snapshots.get(request)
      if (!load) {
        load = requestData(request)
        snapshots.set(request, load)
      }
      return load
    }
    const receipts = new Set<Promise<unknown>>()
    let markedReady = false
    const wrapSync = (
      sync: SyncConfig<DemandRow, string>,
    ): SyncConfig<DemandRow, string> => ({
      ...sync,
      sync: (params) => {
        events.push({ type: `sync run starts` })
        const handlers = sync.sync({
          ...params,
          begin: (options) => {
            if (session === 2 && options?.snapshot) startupResets++
            params.begin(options)
          },
          truncate: (options) => {
            if (session === 2) startupResets++
            params.truncate(options)
          },
          markReady: () => {
            markedReady = true
            params.markReady()
          },
          commit: (...args) => {
            const result = params.commit(...args)
            if (result !== true) {
              receipts.add(result)
              void result.then(
                () => receipts.delete(result),
                () => receipts.delete(result),
              )
            }
            return result
          },
        })
        if (!handlers || typeof handlers === `function` || !handlers.loadSubset)
          throw new Error(`On-demand receiving source has no loadSubset`)
        const loadSubset = handlers.loadSubset
        return {
          ...handlers,
          loadSubset: (request) => {
            const attempt = byRequest.get(request)
            if (!attempt)
              throw new Error(`Raw acquisition has no persisted admission`)
            attempt.sourceStart = Date.now()
            const load = snapshot(request)
            const settled = () => {
              events.push({
                type: `settled`,
                load,
                current: true,
                aborted: request.signal?.aborted,
              })
            }
            const failed = () => {
              if (!request.signal?.aborted)
                events.push({ type: `failed`, load })
            }
            let result: ReturnType<typeof loadSubset>
            try {
              result = loadSubset(request)
            } catch (error) {
              failed()
              throw error
            }
            if (result === true) settled()
            else void result.then(settled, failed)
            return result
          },
        }
      },
    })
    const wrapPersistedSync = (
      sync: SyncConfig<DemandRow, string>,
    ): SyncConfig<DemandRow, string> => ({
      ...sync,
      sync: (params) => {
        // Include hydration and metadata-only wrapper commits as well as the
        // provider's commits recorded by the inner observer.
        const handlers = sync.sync({
          ...params,
          commit: (...args) => {
            const result = params.commit(...args)
            if (result !== true) {
              receipts.add(result)
              void result.then(
                () => receipts.delete(result),
                () => receipts.delete(result),
              )
            }
            return result
          },
        })
        if (!handlers || typeof handlers === `function` || !handlers.loadSubset)
          throw new Error(`Persisted receiving source has no loadSubset`)
        const loadSubset = handlers.loadSubset
        return {
          ...handlers,
          loadSubset: (request) => {
            // Record public admission before startup and hydration awaits.
            // Raw SDK acquisition supplies a later clock for scheduling a
            // post-deadline cut without assuming instant persisted startup.
            const attempt: Attempt = {
              load: snapshot(request),
              start: Date.now(),
              settlement: `pending`,
              signal: request.signal,
            }
            attempts.push(attempt)
            byRequest.set(request, attempt)
            let result: ReturnType<typeof loadSubset>
            try {
              result = loadSubset(request)
            } catch (error) {
              attempt.settlement = `rejected`
              throw error
            }
            if (result === true) attempt.settlement = `fulfilled`
            else
              void result.then(
                () => {
                  attempt.settlement = `fulfilled`
                },
                () => {
                  attempt.settlement = `rejected`
                },
              )
            return result
          },
        }
      },
    })
    const source = await factory({
      id,
      waitMs: history.waitMs,
      persistence: ledger.persistence,
      events,
      wrapSync,
      wrapPersistedSync,
    })
    source.collection.createIndex((row) => row.rank, { indexType: BTreeIndex })
    cleanups.push(source.dispose)
    cleanups.push(() => source.collection.cleanup({ dependents: true }))
    return {
      host,
      ledger,
      source,
      attempts,
      receipts,
      markedReady: () => markedReady,
    }
  }
  const startQuery = (source: DemandReceivingSource, limit: number) => {
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: source.collection })
        .orderBy(({ row }) => row.rank, `asc`)
        .limit(limit),
    )
    const subscription = query.subscribeChanges(() => {})
    cleanups.push(() => query.cleanup())
    cleanups.push(() => subscription.unsubscribe())
    let preload: DemandReceivingCut['preload'] = `pending`
    const pending = query.preload().then(
      () => {
        preload = `fulfilled`
      },
      () => {
        preload = `rejected`
      },
    )
    void pending
    return { query, preload: () => preload }
  }

  return retainOracleCleanupObservation(async () => {
    session = 1
    const first = await create()
    const firstRows = history.first === `empty` ? [] : rows
    if ([`covered`, `empty`, `overlap`].includes(history.first))
      await first.source.answer(firstRows)
    if (history.first === `failed`) await first.source.reject()
    if (history.first !== `never`) {
      const query = startQuery(
        first.source,
        history.first === `overlap` ? 3 : 2,
      )
      await until(
        () => first.source.requests() > 0,
        `first provider acquisition`,
      )
      if ([`covered`, `empty`, `overlap`].includes(history.first)) {
        await until(
          () => query.preload() !== `pending`,
          `online coverage establishment`,
        )
        if (query.preload() !== `fulfilled`)
          throw new Error(`Online coverage premise failed`)
        reached.add(`first ${history.first} applied`)
      } else {
        await first.ledger.barrier(first.source, first.receipts)
        if (history.first === `failed`)
          await until(
            () =>
              first.attempts.some(
                (attempt) => attempt.settlement === `rejected`,
              ),
            `first source failure`,
          )
        reached.add(`first ${history.first} acquisition`)
      }
    } else reached.add(`first never requested`)
    await first.ledger.barrier(first.source, first.receipts)
    requests.push(first.source.requests())
    // Retire consumers first, then the source/provider, then close storage.
    await closeAll()

    session = 2
    const second = await create()
    reached.add(`closed and reopened storage`)
    const beforeStartupEvents = [...events]
    const beforeStartup = await readDemandDurableRows(
      second.host.persistence,
      id,
    )
    if (history.second === `rejected`) await second.source.reject()
    const query = startQuery(second.source, 2)
    await until(
      () => second.source.requests() > 0,
      `offline provider acquisition`,
    )
    const capture = async (name: string) => {
      await second.ledger.barrier(second.source, second.receipts)
      const at = Date.now()
      const observed: QueryObservation = {
        status: query.query.status,
        rows:
          query.query.status === `ready` || query.query.status === `loading`
            ? [...query.query.values()].map((row) => row.id)
            : undefined,
      }
      // Keep every declared provider field beside the readiness record's IDs.
      // Equal keys can carry newer online values. The primary persistence
      // model does not own the live query's additional virtual fields.
      const queryRows =
        observed.rows === undefined
          ? undefined
          : [...query.query.values()].map(
              ({ id: rowId, group, rank, value }) => ({
                id: rowId,
                group,
                rank,
                value,
              }),
            )
      // base is the public exposed source state and does not start another
      // acquisition. A loading live query may withhold its initial graph;
      // the persisted source still owes its restored rows before readiness.
      const sourceWindow = [...second.source.collection.base.values()]
        .filter((row) => row.group === `a`)
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
        .slice(0, 2)
        .map((row) => ({ ...row }))
      const active = second.attempts.filter(
        (attempt) => !attempt.signal?.aborted,
      )
      const waits = active.map(
        (attempt) => at - attempt.start >= history.waitMs,
      )
      if (
        history.first === `covered` &&
        sourceWindow.length &&
        waits.some((passed) => !passed)
      )
        reached.add(`restored source rows before deadline`)
      const record: CoverageRecord = {
        events: [...events],
        queries: {
          demand: {
            spec: { group: `a`, orderByRank: true, limit: 2 },
            sent: active.map((attempt) => attempt.load),
            observed,
          },
        },
        collection: {
          status: second.source.collection.status,
          sourceMarkedReady: second.markedReady(),
        },
        upstream:
          history.second === `rejected` ? `fails at once` : `never answers`,
        waitPassed: false,
      }
      // A durable observation may cross a deadline. It must not change the
      // already captured public state or its per-load timer premises.
      const preload = query.preload()
      const progress = active.map((attempt) => ({
        admittedMsAgo: at - attempt.start,
        sourceStartedMsAgo:
          attempt.sourceStart === undefined
            ? undefined
            : at - attempt.sourceStart,
        settlement: attempt.settlement,
      }))
      const storage = second.ledger.diagnostic(second.receipts)
      const durable = await readDemandDurableRows(second.host.persistence, id)
      cuts.push({
        name,
        record,
        waits,
        preload,
        durable,
        sourceWindow,
        queryRows,
        progress,
        storage,
      })
    }
    await capture(`offline inputs applied`)
    // A finite two-row window can issue a later tie-boundary load. Each round
    // advances the known loads' own deadlines without waiting for readiness.
    for (let round = 0; round < 2; round++) {
      if (history.second === `held`) {
        const deadline = Math.max(
          Date.now(),
          ...second.attempts.map(
            (attempt) =>
              Math.max(attempt.start, attempt.sourceStart ?? 0) +
              history.waitMs,
          ),
        )
        await turn(Math.max(0, deadline - Date.now()) + 2)
      }
      await capture(`offline deadline round ${round + 1}`)
    }
    if (history.lateAnswer) {
      // Same keys and ranks distinguish value replacement from membership.
      // Each factory records the rows its provider actually delivers, which
      // can include a broader page than the live query requested.
      const lateRows =
        history.lateAnswer === `changed values`
          ? rows.map((row) => ({ ...row, value: `online-${row.rank}` }))
          : rows
      const priorEvents = events.length
      await second.source.answer(lateRows)
      await capture(`late provider answer applied`)
      const changed = events
        .slice(priorEvents)
        .some(
          (event) =>
            event.type === `rows` &&
            event.rows.some(([key, row]) =>
              beforeStartup.some(
                (saved) =>
                  saved.id === key &&
                  saved.rank === row.rank &&
                  saved.value !== row.value,
              ),
            ),
        )
      if (changed && history.first === `covered`)
        reached.add(`changed-value late answer supplied after covered reopen`)
    }
    requests.push(second.source.requests())
    return {
      cuts,
      beforeStartup,
      beforeStartupEvents,
      reached: [...reached],
      requests,
      startupResets,
      cleanupErrors: [],
    }
  }, [closeAll])
}
