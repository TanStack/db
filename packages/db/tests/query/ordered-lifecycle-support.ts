// Shared cleanup, initial-settlement, and full-source drivers for the ordered
// lifecycle tests. The oracle file ordered-lifecycle-oracle.property.test.ts
// owns the laws; these helpers only observe the controlled Collections and
// Effects. Ordinary tests here state their expectations by hand.
import { expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { flushPromises } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

export type InitialSettlementShape = `synchronous` | `promise`

export type CapturedOracleFailure = { error: unknown }

export async function finishOracleCleanup(
  primaryFailure: CapturedOracleFailure | undefined,
  cleanups: ReadonlyArray<() => unknown | Promise<unknown>>,
  message: string,
): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
  )
  const cleanupFailures = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (!primaryFailure) {
    if (cleanupFailures.length === 0) return
    throw new AggregateError(cleanupFailures, message, {
      cause: cleanupFailures[0],
    })
  }
  if (cleanupFailures.length === 0) throw primaryFailure.error
  throw new AggregateError(
    [primaryFailure.error, ...cleanupFailures],
    message,
    {
      cause: primaryFailure.error,
    },
  )
}

export type InitialSettlementObservation = {
  rows: Array<number>
  status: string
}

/**
 * ## Initial full-source loads share the synchronous readiness cut
 *
 * A plan whose window cannot come from a provider prefix (an inner join, a
 * functional predicate, `distinct`, or a custom string comparator) loads its
 * ordered source with one filtered full-source request and orders locally.
 * That request is still the query's initial load. When it returns literal
 * `true` after its establishing receipts apply, the live query is ready with
 * its complete window before the initiating call returns, exactly as for the
 * ordinary ordered request above. A Promise result stays asynchronous.
 *
 * The model is the same two-valued reference as the ordinary cut: synchronous
 * settlement predicts ready with ids [1, 2] at the immediate checkpoint, and
 * Promise settlement predicts loading with no rows. The rows come from a
 * three-row source ordered by rank, so the expectation does not read the
 * production comparator. The driver also records the provider request, which
 * must be the predicate-only full-source shape, so a plan that silently took
 * the ordered path cannot pass.
 *
 * A fallback remains in the initial chain when its leading boundary cannot
 * be expressed as a cursor. The warm readiness oracle above checks a null
 * boundary after an ordered request. It observes the request trace and public
 * status immediately after preload starts the sync run, rather than before
 * acquisition. The locale-string cells check the same law for `findOne()`.
 * A Promise result for the fallback keeps the window unpublished at that cut.
 *
 * Replay is outside this cut. After the initial window settles, a truncate
 * replays the same full-source request. Even when its provider answers with
 * literal `true`, the prior window stays published at the call that started
 * the replay and the replacement publishes a task later. This neighbouring case
 * distinguishes a purpose-based gate (initial load versus later authoritative
 * work) from a kind-based one that would make every full-source request
 * synchronous. A requiresFullSource plan holds every source row locally, so an
 * ordinary visible delete recomputes its window without any repair request.
 */

export type FullSourceFeature =
  `inner-join` | `fn-where` | `distinct` | `custom-collation`

export type FullSourceRow = {
  id: number
  rank: number
  label: string
  tag: string
}

const fullSourceRows: ReadonlyArray<FullSourceRow> = [
  { id: 1, rank: 1, label: `a`, tag: `x` },
  { id: 2, rank: 2, label: `b`, tag: `x` },
  { id: 3, rank: 3, label: `c`, tag: `x` },
]

export const fullSourceFeatures: ReadonlyArray<FullSourceFeature> = [
  `inner-join`,
  `fn-where`,
  `distinct`,
  `custom-collation`,
]

const labelRank = new Map([
  [`a`, 1],
  [`b`, 2],
  [`c`, 3],
])

function createFullSourceQuery(
  feature: FullSourceFeature,
  source: Collection<FullSourceRow, number>,
  tags: Collection<{ tag: string }, string>,
) {
  return createLiveQueryCollection({
    startSync: false,
    query: (q) => {
      const base = q.from({ row: source })
      switch (feature) {
        case `inner-join`:
          return base
            .innerJoin({ tag: tags }, ({ row, tag }) => eq(row.tag, tag.tag))
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
        case `fn-where`:
          return base.fn
            .where(({ row }) => row.id > 0)
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
        case `distinct`:
          return base
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
            .distinct()
        case `custom-collation`:
          return base
            .orderBy(({ row }) => row.label, {
              direction: `asc`,
              stringSort: `custom`,
              compare: (a, b) => labelRank.get(a)! - labelRank.get(b)!,
            })
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
      }
    },
  })
}

export function assertFullSourceRequest(
  request: LoadSubsetOptions | undefined,
): void {
  if (
    request === undefined ||
    request.orderBy !== undefined ||
    request.limit !== undefined ||
    request.cursor !== undefined ||
    request.offset !== undefined
  ) {
    throw new Error(
      `Expected one predicate-only full-source request, received ${JSON.stringify(request)}`,
    )
  }
}

export async function observeFullSourceSettlement(
  feature: FullSourceFeature,
  settlement: InitialSettlementShape,
) {
  const delivered = new Set<number>()
  const requests: Array<LoadSubsetOptions> = []
  let sync!: Parameters<SyncConfig<FullSourceRow, number>[`sync`]>[0]
  const source = createCollection<FullSourceRow, number>({
    id: `ordered-full-source-${feature}-${settlement}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            requests.push(options)
            const fresh = fullSourceRows.filter(({ id }) => !delivered.has(id))
            if (fresh.length > 0) {
              sync.begin()
              for (const value of fresh) {
                delivered.add(value.id)
                sync.write({ type: `insert`, value })
              }
              expect(sync.commit()).toBe(true)
            }
            return settlement === `synchronous` ? true : Promise.resolve()
          },
        }
      },
    },
  })
  const tags = createCollection<{ tag: string }, string>({
    id: `ordered-full-source-tags-${feature}-${settlement}`,
    getKey: ({ tag }) => tag,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { tag: `x` } })
        commit()
        markReady()
      },
    },
  })
  const live = createFullSourceQuery(feature, source, tags)
  const subscription = live.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const observeCurrent = (): InitialSettlementObservation => ({
    rows: live.toArray.map(({ id }) => id),
    status: live.status,
  })
  let observation:
    | {
        immediate: InitialSettlementObservation
        settled: InitialSettlementObservation
        requests: Array<LoadSubsetOptions>
      }
    | undefined
  let primaryFailure: CapturedOracleFailure | undefined
  try {
    const preload = live.preload()
    const immediate = observeCurrent()
    await preload
    observation = { immediate, settled: observeCurrent(), requests }
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [
      () => subscription.unsubscribe(),
      () => live.cleanup(),
      () => tags.cleanup(),
      () => source.cleanup(),
    ],
    `Full-source settlement oracle cleanup failed`,
  )
  return observation!
}

export async function observeFullSourceReplay(feature: FullSourceFeature) {
  let served: ReadonlyArray<FullSourceRow> = fullSourceRows
  let sync!: Parameters<SyncConfig<FullSourceRow, number>[`sync`]>[0]
  const source = createCollection<FullSourceRow, number>({
    id: `ordered-full-source-replay-${feature}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: () => {
            const missing = served.filter(({ id }) => !source.has(id))
            if (missing.length > 0) {
              sync.begin()
              for (const value of missing) sync.write({ type: `insert`, value })
              expect(sync.commit()).toBe(true)
            }
            return true
          },
        }
      },
    },
  })
  const tags = createCollection<{ tag: string }, string>({
    id: `ordered-full-source-replay-tags-${feature}`,
    getKey: ({ tag }) => tag,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { tag: `x` } })
        commit()
        markReady()
      },
    },
  })
  const live = createFullSourceQuery(feature, source, tags)
  let primaryFailure: CapturedOracleFailure | undefined
  let observation:
    { immediate: Array<number>; settled: Array<number> } | undefined
  try {
    await live.preload()
    // The source drops row 1 and replays its replacement through a truncate.
    served = fullSourceRows.slice(1)
    sync.begin()
    sync.truncate()
    sync.commit()
    const immediate = live.toArray.map(({ id }) => id)
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    observation = { immediate, settled: live.toArray.map(({ id }) => id) }
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [() => live.cleanup(), () => tags.cleanup(), () => source.cleanup()],
    `Full-source replay oracle cleanup failed`,
  )
  return observation!
}

export async function observeEagerFullSourceSettlement(
  feature: FullSourceFeature,
) {
  const source = createCollection<FullSourceRow, number>({
    id: `ordered-full-source-eager-${feature}`,
    getKey: ({ id }) => id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const value of fullSourceRows) write({ type: `insert`, value })
        commit()
        markReady()
      },
    },
  })
  const tags = createCollection<{ tag: string }, string>({
    id: `ordered-full-source-eager-tags-${feature}`,
    getKey: ({ tag }) => tag,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { tag: `x` } })
        commit()
        markReady()
      },
    },
  })
  const live = createFullSourceQuery(feature, source, tags)
  let primaryFailure: CapturedOracleFailure | undefined
  let immediate: InitialSettlementObservation | undefined
  try {
    const preload = live.preload()
    immediate = {
      rows: live.toArray.map(({ id }) => id),
      status: live.status,
    }
    await preload
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [() => live.cleanup(), () => tags.cleanup(), () => source.cleanup()],
    `Eager full-source settlement oracle cleanup failed`,
  )
  return immediate!
}
