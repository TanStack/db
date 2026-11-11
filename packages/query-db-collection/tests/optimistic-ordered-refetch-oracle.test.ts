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
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { withOracleCleanup } from '../../db/tests/utils'
import { atMutationCheckpoint } from '../../db/tests/mutation-confirmation-support'
import { isNarrowRankTieProbe } from './optimistic-ordered-refetch-probe.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type { QueryCollectionConfig } from '../src/query'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { Row } from './optimistic-ordered-refetch-probe.js'

type ProviderPhase =
  `initial` | `optimistic` | `held-invalidation` | `handler-refetch`

/**
 * # Does a Query DB refetch preserve an optimistic ordered departure?
 *
 * The public window is the first two inbox rows by descending `at`. An
 * optimistic move from inbox to archive removes its row synchronously, even
 * when only the old two-row prefix is installed. A missing replacement may
 * arrive through a bounded provider request, but its Collection write cannot
 * become public before it applies behind the pending mutation. After the
 * authoritative write and refill, the window matches the backend.
 * A prewrite rejection restores the earlier row; a post-confirmation rejection
 * preserves the server edit. Insertions keep their optimistic head while held.
 * The mutation handler calls `utils.refetch()` after changing the provider,
 * matching the receiving path reported in #2169. A second history adds a new
 * provider head and invalidates the Query while persistence is held. Query DB
 * reports shifted loaded subsets, but the resulting repair must not retract
 * the immediate optimistic publication. Its final window follows the backend
 * edit and the handler's source confirmation.
 * CRUD, fulfilled void/legacy returns and rejection before/after confirmation
 * use the same window model. Source publication may need ordered repair after
 * handler settlement; the final cut waits for that fixed point.
 *
 * The reference is the plain remote row ledger and filter/sort/slice below.
 * The real QueryClient and queryCollectionOptions adapter receive each request
 * through their public API. The backend applies LoadSubsetOptions, while the
 * assertions compare public live-query rows and callback snapshots at the
 * immediate, held-refetch, and settled checkpoints. The backend evaluator is
 * only driver wiring: it never computes the expected window.
 */
type OrderedMutationHistory = {
  operation: `insert` | `update` | `delete`
  ending:
    | `fulfilled-void`
    | `fulfilled-legacy`
    | `reject-before-write`
    | `reject-after-write`
  reportDuringHold: boolean
}
const orderedMutationHistories: Array<OrderedMutationHistory> = (
  [`insert`, `update`, `delete`] as const
).flatMap((operation) =>
  (
    [
      `fulfilled-void`,
      `fulfilled-legacy`,
      `reject-before-write`,
      `reject-after-write`,
    ] as const
  ).flatMap((ending) =>
    [false, true].map((reportDuringHold) => ({
      operation,
      ending,
      reportDuringHold,
    })),
  ),
)
async function driveOptimisticOrderedRefetch(
  history: OrderedMutationHistory,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const { operation, ending, reportDuringHold } = history
  const failure = new Error(`ordered handler failure`)
  let handlerConfirmed = false
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
  const persistence = createDeferred<void>()
  let providerPhase: ProviderPhase = `initial`
  const requests: Array<{
    options: LoadSubsetOptions
    ids: Array<number>
    phase: ProviderPhase
  }> = []
  const handler = async ({
    collection,
  }: Pick<
    Parameters<NonNullable<QueryCollectionConfig<Row>[`onUpdate`]>>[0],
    `collection`
  >) => {
    await persistence.promise
    if (ending === `reject-before-write`) throw failure
    if (operation === `insert`) remote.push({ id: 5, folder: `inbox`, at: 5 })
    else if (operation === `delete`)
      remote.splice(
        remote.findIndex(({ id }) => id === 3),
        1,
      )
    else remote.find(({ id }) => id === 3)!.folder = `archive`
    providerPhase = `handler-refetch`
    await collection.utils.refetch()
    handlerConfirmed = true
    if (ending === `reject-after-write`) throw failure
    return ending === `fulfilled-legacy` ? { refetch: false } : undefined
  }
  const runtimeHandler = handler as unknown as (
    params: Parameters<typeof handler>[0],
  ) => Promise<void>
  let unsubscribe: (() => void) | undefined
  let verdict: Promise<unknown> | undefined
  let cleanupSource: (() => Promise<void>) | undefined
  let cleanupLive: (() => Promise<void>) | undefined
  await withOracleCleanup(async () => {
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
        // JavaScript legacy results remain runtime inputs; TypeScript admission
        // is judged separately by the generated handler type owner.
        onInsert: runtimeHandler,
        onUpdate: runtimeHandler,
        onDelete: runtimeHandler,
      }),
    )
    cleanupSource = () => source.cleanup()
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
    cleanupLive = () => live.cleanup()
    const publicIds = () => live.toArray.map(({ id }) => id)
    const publications: Array<Array<number>> = []
    await live.preload()
    observe(`initial`, publicIds())
    observe(`installed`, source.toArray.map(({ id }) => id).sort())
    const subscription = live.subscribeChanges(
      () => publications.push(publicIds()),
      { includeInitialState: true },
    )
    unsubscribe = () => subscription.unsubscribe()
    publications.length = 0

    const initialRequests = requests.length
    providerPhase = `optimistic`
    const transaction =
      operation === `insert`
        ? source.insert({ id: 5, folder: `inbox`, at: 7 })
        : operation === `delete`
          ? source.delete(3)
          : source.update(3, (draft) => {
              draft.folder = `archive`
            })
    verdict = transaction.when(`settled`).then(
      () => undefined,
      (error: unknown) => error,
    )
    observe(`optimistic`, publicIds())
    observe(
      `optimistic-publications`,
      publications.map((ids) => [...ids]),
    )
    observe(`cut optimistic`, true)

    if (operation !== `insert`) {
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
      observe(`cut bounded-refill`, true)
    }
    for (const { options, ids } of requests.filter(
      ({ phase }) => phase === `optimistic`,
    )) {
      const orderedPage =
        options.orderBy?.[0]?.compareOptions.direction === `desc` &&
        options.limit !== undefined &&
        options.limit <= 4
      const rankTieProbe = isNarrowRankTieProbe(options, remote)
      observe(`optimistic-request`, {
        orderedOrTie: orderedPage || rankTieProbe,
        archiveIncluded: ids.includes(4),
      })
    }
    observe(`held-optimistic`, publicIds())
    observe(
      `held-publications`,
      publications.map((ids) => [...ids]),
    )

    if (reportDuringHold) {
      const head = operation === `insert` ? 6 : 5
      remote.push({ id: head, folder: `inbox`, at: head })
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
                ids.includes(head),
            ),
        ).toBe(true),
      )
      observe(`reported-optimistic`, publicIds())
      observe(
        `reported-publications`,
        publications.map((ids) => [...ids]),
      )
      observe(`cut held-report`, true)
    }

    persistence.resolve()
    const actualError = await atMutationCheckpoint(
      verdict,
      `ordered handler settlement`,
    )
    observe(
      `handler-error-identity`,
      actualError === (ending.startsWith(`reject`) ? failure : undefined),
    )
    observe(`transaction-state`, transaction.state)
    if (ending !== `reject-before-write`) {
      observe(`handler-confirmed`, handlerConfirmed)
      observe(`cut handler-confirmation`, true)
    }
    if (
      !reportDuringHold &&
      operation !== `insert` &&
      ending !== `reject-before-write`
    ) {
      observe(
        `handler-refill`,
        requests.some(
          ({ phase, ids }) =>
            phase === `handler-refetch` && ids.includes(1) && !ids.includes(3),
        ),
      )
    }
    await vi.waitFor(() =>
      checkOrderedMutationObservation(
        remote,
        history.ending,
        {
          ids: publicIds(),
          error: actualError,
          state: transaction.state,
        },
        failure,
      ),
    )
    observe(`settled`, publicIds())
    observe(`settled-publication`, publications.at(-1))
    observe(`cut settled-fixed-point`, true)
  }, [
    () => persistence.resolve(),
    () =>
      verdict && atMutationCheckpoint(verdict, `ordered cleanup settlement`),
    () => unsubscribe?.(),
    () => cleanupLive?.(),
    () => cleanupSource?.(),
    () => queryClient.clear(),
  ])
}

/**
 * The public window of the live query `inbox` order `at desc` limit 2, computed
 * from the plain remote row ledger. This is the model that the check compares
 * the live rows against at each checkpoint.
 */
function expectedPublicWindow(remote: ReadonlyArray<Row>): Array<number> {
  return remote
    .filter(({ folder }) => folder === `inbox`)
    .sort((left, right) => right.at - left.at)
    .slice(0, 2)
    .map(({ id }) => id)
}

// Ordering derives from the backend ledger, while outcome derives from the
// handler's Promise. Rejecting after confirmation changes only the latter.
function checkOrderedMutationObservation(
  remote: ReadonlyArray<Row>,
  ending: OrderedMutationHistory[`ending`],
  observed: { ids: Array<number>; error: unknown; state: string },
  failure: Error,
): void {
  expect(observed.ids).toEqual(expectedPublicWindow(remote))
  expect(observed.error).toBe(ending.startsWith(`reject`) ? failure : undefined)
  expect(observed.state).toBe(
    ending.startsWith(`reject`) ? `failed` : `completed`,
  )
}

declareOracle({
  check: [checkOrderedMutationTrace, checkOrderedMutationObservation],
  model: [expectedPublicWindow],
  grammar: [orderedMutationHistories],
})

// Recompute the original immediate and settled windows from the authored
// operation and handler ending. Request shapes stay observations of the real
// adapter; they do not decide the independent row ledger.
function modelOrderedMutation(history: OrderedMutationHistory) {
  const { operation, ending, reportDuringHold } = history
  const remote: Array<Row> = [-1, 0, 1, 2, 3, 4].map((id) => ({
    id,
    folder: id === 4 ? `archive` : `inbox`,
    at: id,
  }))
  const installed = remote
    .filter((row) => expectedPublicWindow(remote).includes(row.id))
    .map((row) => ({ ...row }))
  const optimisticRows =
    operation === `insert`
      ? [...installed, { id: 5, folder: `inbox` as const, at: 7 }]
      : operation === `delete`
        ? installed.filter(({ id }) => id !== 3)
        : installed.map((row) =>
            row.id === 3 ? { ...row, folder: `archive` as const } : row,
          )
  const immediate = expectedPublicWindow(optimisticRows)
  const initial = expectedPublicWindow(remote)
  if (reportDuringHold) {
    const head = operation === `insert` ? 6 : 5
    remote.push({ id: head, folder: `inbox`, at: head })
  }
  if (ending !== `reject-before-write`) {
    if (operation === `insert`) remote.push({ id: 5, folder: `inbox`, at: 5 })
    else if (operation === `delete`)
      remote.splice(
        remote.findIndex(({ id }) => id === 3),
        1,
      )
    else remote.find(({ id }) => id === 3)!.folder = `archive`
  }
  const settled = expectedPublicWindow(remote)
  return {
    initial,
    installed: [2, 3],
    optimistic: immediate,
    'optimistic-publications': [immediate],
    'cut optimistic': true,
    ...(operation !== `insert` ? { 'cut bounded-refill': true } : {}),
    'held-optimistic': immediate,
    'held-publications': immediate,
    ...(reportDuringHold
      ? {
          'reported-optimistic': immediate,
          'reported-publications': [immediate],
          'cut held-report': true,
        }
      : {}),
    'handler-error-identity': true,
    'transaction-state': ending.startsWith(`reject`) ? `failed` : `completed`,
    ...(ending !== `reject-before-write`
      ? { 'handler-confirmed': true, 'cut handler-confirmation': true }
      : {}),
    ...(!reportDuringHold &&
    operation !== `insert` &&
    ending !== `reject-before-write`
      ? { 'handler-refill': true }
      : {}),
    settled,
    'settled-publication': settled,
    'cut settled-fixed-point': true,
  }
}
function checkOrderedMutationTrace(
  _history: OrderedMutationHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelOrderedMutation>,
): Verdict {
  const owed: Readonly<Record<string, unknown>> = expected
  const seen = new Set<string>()
  for (const observation of trace) {
    if (observation.checkpoint === `optimistic-request`) {
      const verdict = differs(
        observation.checkpoint,
        `bounded optimistic refill`,
        observation.value,
        { orderedOrTie: true, archiveIncluded: false },
      )
      if (verdict) return verdict
    } else if (observation.checkpoint === `held-publications`) {
      const snapshots = observation.value as Array<Array<number>>
      seen.add(observation.checkpoint)
      for (const ids of snapshots) {
        const verdict = differs(
          observation.checkpoint,
          `optimistic publication`,
          ids,
          expected.optimistic,
        )
        if (verdict) return verdict
      }
    } else {
      const verdict = differs(
        observation.checkpoint,
        `ordered mutation`,
        observation.value,
        owed[observation.checkpoint],
      )
      if (verdict) return verdict
      seen.add(observation.checkpoint)
    }
  }
  return (
    differs(
      `complete ordered mutation`,
      `ordered mutation`,
      [...seen].sort(),
      Object.keys(expected).sort(),
    ) ?? pass
  )
}

// All24 original histories remain finite inputs to the same production path.
// Each cut formerly counted by local reach is now a required native observation.
oracleProperty({
  id: `query.ordered-mutation-outcome`,
  law: {
    statement: `Optimistic ordered CRUD keeps its immediate publication while persistence is held, then follows the authoritative backend window and handler outcome.`,
    authority: `queryCollectionOptions mutation and ordered-refetch contracts; oracle-coverage.md, Query DB ordered refetch`,
    limits: `Finite controlled QueryClient histories, one bounded inbox window and handler-refetch path; no HTTP or framework host claim.`,
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: orderedMutationHistories,
  model: modelOrderedMutation,
  driver: driveOptimisticOrderedRefetch,
  check: checkOrderedMutationTrace,
})

// These controls challenge the same public-window/outcome comparison. They
// establish sensitivity without changing any production code.
it.each([
  `rollback-confirmed-row`,
  `discarded-value-failure`,
  `reversed-order`,
] as const)(`rejects ordered wrong observation: %s`, (fault) => {
  oracleRoute(`calibration`)
  const remote: Array<Row> = [
    { id: 1, folder: `inbox`, at: 1 },
    { id: 2, folder: `inbox`, at: 2 },
  ]
  const ending =
    fault === `rollback-confirmed-row`
      ? `reject-after-write`
      : `fulfilled-legacy`
  const failure = new Error(`handler failure`)
  const actual = {
    ids: expectedPublicWindow(remote),
    error:
      ending === `reject-after-write`
        ? (failure as unknown)
        : (undefined as unknown),
    state: ending === `reject-after-write` ? `failed` : `completed`,
  }
  checkOrderedMutationObservation(remote, ending, actual, failure)
  if (fault === `rollback-confirmed-row`) actual.ids = [3, 2]
  if (fault === `discarded-value-failure`) {
    actual.error = new Error(`legacy value`)
    actual.state = `failed`
  }
  if (fault === `reversed-order`) actual.ids.reverse()
  expect(() =>
    checkOrderedMutationObservation(remote, ending, actual, failure),
  ).toThrow()
})
