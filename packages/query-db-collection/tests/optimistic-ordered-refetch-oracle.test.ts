import { QueryClient } from '@tanstack/query-core'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import { applyPredicates } from '../e2e/query-filter.js'
import type { LoadSubsetOptions } from '@tanstack/db'

type Row = { id: number; folder: `inbox` | `archive`; at: number }
type ProviderPhase =
  `initial` | `optimistic` | `held-invalidation` | `handler-refetch`

// A boundary probe may omit ordering, but its predicate must select one rank.
// Add another row at that rank so a key-specific request cannot masquerade as
// a rank-tie probe. Evaluate the whole predicate scope, not the capped answer.
function isNarrowRankTieProbe(
  options: LoadSubsetOptions,
  remote: Array<Row>,
): boolean {
  if (options.orderBy !== undefined || options.where === undefined) return false
  const matches = applyPredicates(remote, { where: options.where })
  if (matches.length === 0) return false
  const rank = matches[0]!.at
  if (matches.some((row) => row.at !== rank)) return false
  const additionalTie: Row = { ...matches[0]!, id: 1000 }
  return applyPredicates([...remote, additionalTie], {
    where: options.where,
  }).some((row) => row.id === additionalTie.id)
}

/**
 * # Does a Query DB refetch preserve an optimistic ordered departure?
 *
 * The public window is the first two inbox rows by descending `at`. An
 * optimistic move from inbox to archive removes its row synchronously, even
 * when only the old two-row prefix is installed. A missing replacement may
 * arrive through a bounded provider request, but its Collection write cannot
 * become public before it applies behind the pending mutation. After the
 * mutation's authoritative write and refill apply, the window is `[2, 1]`.
 * The mutation handler calls `utils.refetch()` after changing the provider,
 * matching the receiving path reported in #2169. A second history adds a new
 * provider head and invalidates the Query while persistence is held. Query DB
 * reports shifted loaded subsets, but the resulting repair must not retract
 * the immediate `[2]` publication. It settles as `[5, 2]` after persistence.
 *
 * The reference is the plain remote row ledger and filter/sort/slice below.
 * The real QueryClient and queryCollectionOptions adapter receive each request
 * through their public API. The backend applies LoadSubsetOptions, while the
 * assertions compare public live-query rows and callback snapshots at the
 * immediate, held-refetch, and settled checkpoints. The backend evaluator is
 * only driver wiring: it never computes the expected window.
 */
async function checkOptimisticOrderedRefetch(
  reportDuringHold: boolean,
): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const remote: Array<Row> = [-1, 0, 1, 2, 3, 4].map((id) => ({
    id,
    folder: id === 4 ? `archive` : `inbox`,
    at: id,
  }))
  const expected = () =>
    remote
      .filter(({ folder }) => folder === `inbox`)
      .sort((left, right) => right.at - left.at)
      .slice(0, 2)
      .map(({ id }) => id)
  const persistence = createDeferred<void>()
  let providerPhase: ProviderPhase = `initial`
  const requests: Array<{
    options: LoadSubsetOptions
    ids: Array<number>
    phase: ProviderPhase
  }> = []
  const source = createCollection(
    queryCollectionOptions<Row>({
      id: `optimistic-query-refetch`,
      queryKey: [`optimistic-query-refetch`],
      queryClient,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      queryFn: ({ meta }) => {
        const options = meta?.loadSubsetOptions ?? {}
        const rows = applyPredicates(remote, options).map((row) => ({
          ...row,
        }))
        requests.push({
          options,
          ids: rows.map(({ id }) => id),
          phase: providerPhase,
        })
        return rows
      },
      onUpdate: async ({ collection }) => {
        await persistence.promise
        const moved = remote.find(({ id }) => id === 3)!
        moved.folder = `archive`
        providerPhase = `handler-refetch`
        await collection.utils.refetch()
        return { refetch: false }
      },
    }),
  )
  source.createIndex((row) => row.at, { indexType: BTreeIndex })
  let reports = 0
  let requestCountAtReport = 0
  source.on(`loadedSubsets:invalidated`, () => {
    reports++
    requestCountAtReport = requests.length
  })
  const live = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.folder, `inbox`))
        .orderBy(({ row }) => row.at, `desc`)
        .limit(2),
  })
  const publicIds = () => live.toArray.map(({ id }) => id)
  const publications: Array<Array<number>> = []
  let unsubscribe: (() => void) | undefined
  try {
    await live.preload()
    expect(publicIds()).toEqual(expected())
    expect(source.toArray.map(({ id }) => id).sort()).toEqual([2, 3])
    const subscription = live.subscribeChanges(
      () => publications.push(publicIds()),
      { includeInitialState: true },
    )
    unsubscribe = () => subscription.unsubscribe()
    publications.length = 0

    const initialRequests = requests.length
    providerPhase = `optimistic`
    const transaction = source.update(3, (draft) => {
      draft.folder = `archive`
    })
    expect(publicIds()).toEqual([2])
    expect(publications).toEqual([[2]])

    await vi.waitFor(() => {
      expect(requests.length).toBeGreaterThan(initialRequests)
      expect(
        requests
          .slice(initialRequests)
          .some(
            ({ options, ids }) =>
              options.orderBy?.[0]?.compareOptions.direction === `desc` &&
              options.limit !== undefined &&
              options.limit <= 4 &&
              ids.includes(1),
          ),
      ).toBe(true)
    })
    for (const { options, ids } of requests.filter(
      ({ phase }) => phase === `optimistic`,
    )) {
      const orderedPage =
        options.orderBy?.[0]?.compareOptions.direction === `desc` &&
        options.limit !== undefined &&
        options.limit <= 4
      const rankTieProbe = isNarrowRankTieProbe(options, remote)
      expect(orderedPage || rankTieProbe).toBe(true)
      expect(ids).not.toContain(4)
    }
    expect(publicIds()).toEqual([2])
    expect(
      publications.every(
        (snapshot) => snapshot.length === 1 && snapshot[0] === 2,
      ),
    ).toBe(true)

    if (reportDuringHold) {
      remote.push({ id: 5, folder: `inbox`, at: 5 })
      providerPhase = `held-invalidation`
      await queryClient.invalidateQueries({
        queryKey: [`optimistic-query-refetch`],
      })
      await vi.waitFor(() => expect(reports).toBe(1))
      await vi.waitFor(() =>
        expect(
          requests
            .slice(requestCountAtReport)
            .some(
              ({ options, ids, phase }) =>
                phase === `held-invalidation` &&
                options.orderBy?.[0]?.compareOptions.direction === `desc` &&
                options.limit !== undefined &&
                options.limit <= 4 &&
                ids.includes(5),
            ),
        ).toBe(true),
      )
      expect(publicIds()).toEqual([2])
      expect(publications).toEqual([[2]])
    }

    persistence.resolve()
    await transaction.isPersisted.promise
    if (!reportDuringHold) {
      expect(
        requests.some(
          ({ phase, ids }) =>
            phase === `handler-refetch` && ids.includes(1) && !ids.includes(3),
        ),
      ).toBe(true)
    }
    await vi.waitFor(() => expect(publicIds()).toEqual(expected()))
    expect(publicIds()).toEqual(reportDuringHold ? [5, 2] : [2, 1])
    expect(publications.at(-1)).toEqual(publicIds())
  } finally {
    persistence.resolve()
    unsubscribe?.()
    await live.cleanup()
    await source.cleanup()
    queryClient.clear()
  }
}

it(`publishes a short optimistic window during a mutation-handler refetch`, () =>
  checkOptimisticOrderedRefetch(false))

it(`keeps the short optimistic window through a held refetch report`, () =>
  checkOptimisticOrderedRefetch(true))

it(`rejects an unordered page cap as a rank-tie probe`, () => {
  const remote: Array<Row> = [1, 2, 3].map((id) => ({
    id,
    folder: `inbox`,
    at: id,
  }))
  expect(isNarrowRankTieProbe({ limit: 1 }, remote)).toBe(false)
  expect(isNarrowRankTieProbe({}, [])).toBe(false)
})
