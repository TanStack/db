/**
 * A finite online prefix does not establish the absence of a saved suffix.
 * This receiver uses the primary persisted-demand model's source facts and
 * judgment. A five-row demand establishes durable coverage against a source
 * wider than either window. Fresh SDK and SQLite instances then reopen it.
 *
 * The small demand reaches its provider first. A real optimistic transaction
 * holds application while the larger demand's persisted restore is accepted.
 * Only the small provider prefix answers. Before releasing application, the
 * factory holds further provider work. Thus the large demand's saved suffix
 * must survive without a large provider answer supplying it again.
 *
 * Acceptance records below observe core commit receipts and their writes;
 * they are premise evidence, never expected rows. Public source/query rows and
 * an independent durable read are recorded after the optimistic hold releases.
 * The primary model alone decides saved coverage, values and readiness.
 */
import {
  BTreeIndex,
  createLiveQueryCollection,
  createTransaction,
} from '@tanstack/db'
import { plainLoadSnapshot } from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import {
  retainOracleCleanupObservation,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { readDemandDurableRows } from './persisted-demand-receiving-driver'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type {
  CoverageRecord,
  SourceEvent,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type { DemandReceivingSession } from './persisted-demand-receiving-driver'
import type {
  DemandReceivingFactory,
  DemandRow,
} from './persisted-demand-receiving-types'

export type DemandPeerHistory = { size: 8 | 9; changed: boolean; tied?: true }
type Owner = `small` | `large`
type Attempt = {
  owner: Owner
  load: LoadSubsetOptions
  admitted: number
  raw?: number
  settlement: `pending` | `fulfilled` | `rejected`
  signal?: AbortSignal
}
type Batch = {
  rows: Array<DemandRow>
  pending: boolean
  replacement: boolean
}
export type DemandPeerCut = {
  name: string
  record: CoverageRecord
  durable: Array<Record<string, unknown>>
  sourceRows: Array<DemandRow>
  largeRows: Array<DemandRow>
  largePreload: Attempt['settlement']
  waits: Array<boolean>
}
export type DemandPeerResult = {
  cuts: Array<DemandPeerCut>
  reached: Array<string>
  premise: {
    acceptedSuffix: Array<string>
    acceptedBeforeAnswer: Array<string>
    appliedBeforeAnswer: Array<string>
    rawLargeBeforeAnswer: number
    rawLargeAfterRelease: number
    providerPrefix: Array<string>
    replacements: number
  }
  cleanupErrors: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
}
const turn = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 10000
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`Unreached peer premise: ${label}`)
    await turn(2)
  }
}
const copyRows = (rows: Iterable<DemandRow>) =>
  [...rows]
    .filter((row) => row.group === `a`)
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map(({ id, group, rank, value }) => ({ id, group, rank, value }))

export async function observePersistedDemandPeer(
  history: DemandPeerHistory,
  id: string,
  factory: DemandReceivingFactory,
  open: () => Promise<DemandReceivingSession> | DemandReceivingSession,
): Promise<DemandPeerResult> {
  const rows = Array.from({ length: history.size }, (_, offset) => ({
    id: `row-${offset + 1}`,
    group: `a`,
    rank: history.tied && offset === 4 ? 4 : offset + 1,
    value: `saved-${offset + 1}`,
  }))
  const waitMs = 1000
  const events: Array<SourceEvent> = []
  const reached = new Set<string>()
  const cuts: Array<DemandPeerCut> = []
  const cleanups: Array<() => unknown> = []
  const closeAll = () =>
    withOracleCleanup(() => {}, cleanups.splice(0).reverse())
  let owner: Owner = `large`
  const create = async () => {
    const host = await open()
    cleanups.push(host.close)
    const attempts: Array<Attempt> = []
    const requestAttempts = new WeakMap<LoadSubsetOptions, Attempt>()
    const subscriptions = new WeakMap<object, Owner>()
    const snapshots = new WeakMap<LoadSubsetOptions, LoadSubsetOptions>()
    const batches: Array<Batch> = []
    const storage = new Set<Promise<unknown>>()
    const receipts = new Set<Promise<unknown>>()
    const failures: Array<unknown> = []
    const snapshot = (request: LoadSubsetOptions) => {
      let plain = snapshots.get(request)
      if (!plain) {
        plain = plainLoadSnapshot({
          where: request.where,
          orderBy: request.orderBy,
          limit: request.limit,
          offset: request.offset,
          cursor: request.cursor,
          refetch: request.refetch,
        })
        snapshots.set(request, plain)
      }
      return plain
    }
    const track = (promise: Promise<unknown>, set: Set<Promise<unknown>>) => {
      set.add(promise)
      void promise.then(
        () => set.delete(promise),
        (cause: unknown) => {
          set.delete(promise)
          failures.push(cause)
        },
      )
    }
    const adapter = new Proxy(host.persistence.adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target)
        if (typeof value !== `function`) return value
        return (...args: Array<unknown>) => {
          const result: unknown = Reflect.apply(value, target, args)
          if (result instanceof Promise) track(result, storage)
          return result
        }
      },
    })
    const wrapSync = (
      sync: SyncConfig<DemandRow, string>,
    ): SyncConfig<DemandRow, string> => ({
      ...sync,
      sync: (params) => {
        events.push({ type: `sync run starts` })
        const handlers = sync.sync(params)
        if (!handlers || typeof handlers === `function` || !handlers.loadSubset)
          throw new Error(`Peer source requires on-demand handlers`)
        const loadSubset = handlers.loadSubset
        return {
          ...handlers,
          loadSubset: (request) => {
            const attempt = requestAttempts.get(request)
            if (!attempt) throw new Error(`Peer raw load has no admission`)
            attempt.raw = Date.now()
            const load = snapshot(request)
            const settled = () =>
              events.push({
                type: `settled`,
                load,
                current: true,
                aborted: request.signal?.aborted,
              })
            const failed = () => events.push({ type: `failed`, load })
            const result = loadSubset(request)
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
        let batch: Batch = { rows: [], pending: false, replacement: false }
        const handlers = sync.sync({
          ...params,
          begin: (options) => {
            batch = {
              rows: [],
              pending: false,
              replacement: options?.snapshot === true,
            }
            params.begin(options)
          },
          truncate: (options) => {
            batch.replacement = true
            params.truncate(options)
          },
          write: (message) => {
            if (message.type !== `delete`) batch.rows.push({ ...message.value })
            params.write(message)
          },
          commit: (...args) => {
            const committed = batch
            const receipt = params.commit(...args)
            batches.push(committed)
            if (receipt !== true) {
              committed.pending = true
              track(receipt, receipts)
              void receipt.then(
                () => {
                  committed.pending = false
                },
                () => {
                  committed.pending = false
                },
              )
            }
            return receipt
          },
        })
        if (!handlers || typeof handlers === `function` || !handlers.loadSubset)
          throw new Error(`Peer persisted source requires loadSubset`)
        const loadSubset = handlers.loadSubset
        return {
          ...handlers,
          loadSubset: (request) => {
            const subscription = request.subscription
            if (subscription && !subscriptions.has(subscription))
              subscriptions.set(subscription, owner)
            const attempt: Attempt = {
              owner: subscription ? subscriptions.get(subscription)! : owner,
              load: snapshot(request),
              admitted: Date.now(),
              settlement: `pending`,
              signal: request.signal,
            }
            attempts.push(attempt)
            requestAttempts.set(request, attempt)
            const result = loadSubset(request)
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
      waitMs,
      events,
      persistence: { ...host.persistence, adapter },
      wrapSync,
      wrapPersistedSync,
    })
    source.collection.createIndex((row) => row.rank, { indexType: BTreeIndex })
    cleanups.push(source.dispose)
    cleanups.push(() => source.collection.cleanup({ dependents: true }))
    const drain = async (includeReceipts = true) => {
      // Finite continuation allowance, independent of readiness and row values.
      for (let index = 0; index < 3; index++) {
        await source.barrier()
        await Promise.all([...storage, ...(includeReceipts ? receipts : [])])
        await turn(30)
      }
      if (failures.length)
        throw new AggregateError(failures, `Peer source input failed`)
    }
    const start = (name: Owner, limit: number) => {
      owner = name
      const query = createLiveQueryCollection((q) =>
        q
          .from({ row: source.collection })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(limit),
      )
      const subscription = query.subscribeChanges(() => {})
      cleanups.push(() => query.cleanup())
      cleanups.push(() => subscription.unsubscribe())
      let preload: Attempt['settlement'] = `pending`
      void query.preload().then(
        () => {
          preload = `fulfilled`
        },
        () => {
          preload = `rejected`
        },
      )
      return { query, preload: () => preload }
    }
    return { host, source, attempts, batches, drain, start }
  }
  return retainOracleCleanupObservation(async () => {
    const first = await create()
    await first.source.answer(rows)
    const saved = first.start(`large`, 5)
    await until(
      () => saved.preload() !== `pending`,
      `large online demand settles`,
    )
    if (saved.preload() !== `fulfilled`)
      throw new Error(`Large online coverage premise failed`)
    await first.drain()
    reached.add(`large online demand durably covered`)
    await closeAll()

    const second = await create()
    if (!second.source.hold)
      throw new Error(`Peer source requires provider hold`)
    second.start(`small`, 2)
    await until(
      () =>
        second.attempts.some(
          (attempt) => attempt.owner === `small` && attempt.raw !== undefined,
        ),
      `small raw acquisition`,
    )
    await second.drain()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = createTransaction({ mutationFn: () => gate })
    transaction.mutate(() =>
      second.source.collection.insert({
        id: `optimistic`,
        group: `other`,
        rank: 10000,
        value: `optimistic only`,
      }),
    )
    const releaseHold = async () => {
      release()
      await transaction.when(`settled`)
    }
    cleanups.push(releaseHold)
    const large = second.start(`large`, 5)
    await until(
      () =>
        second.batches.some(
          (batch) =>
            batch.pending && batch.rows.some((row) => row.id === `row-5`),
        ),
      `large suffix restore accepted behind optimistic hold`,
    )
    const acceptedSuffix = second.batches
      .filter((batch) => batch.pending)
      .flatMap((batch) =>
        batch.rows
          .filter((row) => Number(row.id.slice(`row-`.length)) >= 5)
          .map((row) => row.id),
      )
    const appliedBeforeAnswer = copyRows(
      second.source.collection.base.values(),
    ).map((row) => row.id)
    // Acceptance is premise evidence only. The public and durable judgments
    // below derive their expected values from authored provider facts.
    const acceptedBeforeAnswer = [
      ...second.source.collection._state.acceptedSyncedEntries(),
    ].map(([key]) => String(key))
    const rawLargeBeforeAnswer = second.attempts.filter(
      (attempt) => attempt.owner === `large` && attempt.raw !== undefined,
    ).length
    if (
      !acceptedSuffix.length ||
      acceptedSuffix.some((key) => !acceptedBeforeAnswer.includes(key)) ||
      acceptedSuffix.some((key) => appliedBeforeAnswer.includes(key)) ||
      rawLargeBeforeAnswer !== 0
    )
      throw new Error(
        `Large restore did not remain accepted and unapplied before its raw acquisition`,
      )
    reached.add(`large saved suffix accepted and unapplied`)
    reached.add(`large raw acquisition waits behind restore`)
    const eventOffset = events.length
    await second.source.answer(
      history.changed
        ? rows.map((row) => ({ ...row, value: `online-${row.rank}` }))
        : rows,
    )
    await second.source.hold()
    await second.drain(false)
    const providerPrefix = events
      .slice(eventOffset)
      .flatMap((event) =>
        event.type === `rows` ? event.rows.map(([key]) => key) : [],
      )
    if (!providerPrefix.length || providerPrefix.includes(`row-5`))
      throw new Error(
        `Small reply was not a strict finite prefix before the saved suffix`,
      )
    reached.add(`finite small prefix consumed before large raw acquisition`)
    if (
      history.tied &&
      acceptedSuffix.includes(`row-5`) &&
      providerPrefix.includes(`row-4`)
    )
      reached.add(`saved suffix shares finite prefix boundary rank`)
    await releaseHold()
    await until(
      () =>
        second.attempts.some(
          (attempt) => attempt.owner === `large` && attempt.raw !== undefined,
        ),
      `large raw acquisition after restore application`,
    )
    const capture = async (name: string) => {
      await second.drain()
      const now = Date.now()
      const active = second.attempts.filter(
        (attempt) => attempt.owner === `large` && !attempt.signal?.aborted,
      )
      const sourceRows = copyRows(second.source.collection.base.values())
      const largeRows = copyRows(large.query.values())
      const record: CoverageRecord = {
        events: [...events],
        queries: {
          large: {
            spec: { group: `a`, orderByRank: true, limit: 5 },
            sent: active.map((attempt) => attempt.load),
            observed: {
              status: large.query.status,
              rows: largeRows.map((row) => row.id),
            },
          },
        },
        upstream: `never answers`,
        waitPassed: false,
      }
      // Functions do not cross the browser boundary. Materialize each load's
      // wait premise in an index-aligned list for the shared suite to restore.
      const waits = active.map((attempt) => now - attempt.admitted >= waitMs)
      const largePreload = large.preload()
      cuts.push({
        name,
        record,
        durable: await readDemandDurableRows(second.host.persistence, id),
        sourceRows,
        largeRows,
        largePreload,
        waits,
      })
    }
    await capture(`saved suffix after finite prefix applies`)
    for (let round = 0; round < 2; round++) {
      const deadline = Math.max(
        Date.now(),
        ...second.attempts.map(
          (attempt) => Math.max(attempt.admitted, attempt.raw ?? 0) + waitMs,
        ),
      )
      await turn(Math.max(0, deadline - Date.now()) + 2)
      await capture(`large offline deadline ${round + 1}`)
    }
    reached.add(`large offline deadline observed without provider answer`)
    return {
      cuts,
      reached: [...reached],
      cleanupErrors: [],
      premise: {
        acceptedSuffix,
        acceptedBeforeAnswer,
        appliedBeforeAnswer,
        rawLargeBeforeAnswer,
        rawLargeAfterRelease: second.attempts.filter(
          (attempt) => attempt.owner === `large` && attempt.raw !== undefined,
        ).length,
        providerPrefix,
        replacements: second.batches.filter((batch) => batch.replacement)
          .length,
      },
    }
  }, [closeAll])
}
