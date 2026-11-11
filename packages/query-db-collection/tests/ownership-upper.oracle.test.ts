import { hashKey } from '@tanstack/query-core'
import {
  IR,
  createCollection,
  createOptimisticAction,
  createTransaction,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, vi } from 'vitest'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import {
  cleanups,
  createOwnershipFixture,
  createQueryClient,
  detailOnly,
  listOnly,
  runCleanups,
  shared,
} from './ownership-lifecycle-support.js'
import {
  createRefetchCallSettlementModel,
  handlerCollectionHistoryGrammar,
  mutationRefreshHistoryGrammar,
  observeExplicitRefetchApplication,
  observeFetchRecordSuccessorWork,
  observeHandlerIdentity,
  observeHandlerRefetchBoundary,
  observeMutationRefreshLiveness,
  observeQueryCacheWork,
  observeRefetchCallSettlement,
  reduceExplicitRefetchApplication,
  reduceMutationRefreshLiveness,
  reduceRefetchCallSettlement,
} from './ownership-model-oracle'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'

import type { Item, OwnershipFixture } from './ownership-lifecycle-support.js'
import type { QueryCollectionUtils } from '../src/query.js'
import type { QueryClient } from '@tanstack/query-core'
import type { Transaction } from '@tanstack/db'
import type {
  HandlerIdentityObservation,
  MutationHandlerKind,
  MutationRefreshLivenessModel,
  RefetchApplicationOutcome,
} from './ownership-model-oracle'

afterEach(runCleanups)
type Emit = (checkpoint: string, value: unknown) => void
async function recordBoundary<T>(
  checkpoint: string,
  read: () => T,
  arrived: (value: T) => boolean,
  emit: Emit,
): Promise<boolean> {
  for (let turn = 0; turn < 200; turn++) {
    if (arrived(read())) {
      emit(checkpoint, read())
      return true
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  emit(checkpoint, read())
  return false
}
async function settled<T>(
  promise: Promise<T>,
): Promise<
  { outcome: 'fulfilled'; value: T } | { outcome: 'rejected'; error: unknown }
> {
  return promise.then(
    (value) => ({ outcome: 'fulfilled', value }),
    (error) => ({ outcome: 'rejected', error }),
  )
}
function compareCuts(
  actual: ReadonlyArray<Observation>,
  expected: ReadonlyArray<Observation>,
  law: string,
): Verdict {
  for (let i = 0; i < expected.length; i++) {
    const wanted = expected[i]!
    if (!actual[i])
      return violation(
        wanted.checkpoint,
        'the required observation cut did not arrive',
        law,
      )
    const bad = differs(wanted.checkpoint, law, actual[i], wanted)
    if (bad) return bad
  }
  return differs('trace-length', law, actual.length, expected.length) ?? pass
}

/**
 * Public explicit refetch and mutation-phase overlap share the existing call,
 * application and wait-for-graph models. The histories below author only call
 * scope, source fulfillment, application fulfillment/rejection and mutation
 * phase. None of their expected rows or settlements reads the production trace.
 * Numeric registration coordinates preserve the old replay cases during this
 * scratch extraction; final replay names are assigned by the parent.
 */
type UpperHistory = {
  site: number
  id: string
  initialName: string
  authoritativeName: string
  legacyOperation: 'refetch' | 'clearError'
  schedule:
    | 'mutation-first'
    | 'refresh-first-during-fetch'
    | 'refresh-first-during-application'
  invocation:
    | 'manual-transaction'
    | 'optimistic-action'
    | 'captured-handler-collection'
    | 'external-handler-overlap'
    | 'external-persisted-application-overlap'
  handlerKind: 'insert' | 'update' | 'delete'
  accessPath: 'parameter' | 'mutation-alias'
}
const baseHistory: UpperHistory = {
  site: 0,
  id: '',
  initialName: 'Initial',
  authoritativeName: 'Authoritative',
  legacyOperation: 'refetch',
  schedule: 'mutation-first',
  invocation: 'manual-transaction',
  handlerKind: 'update',
  accessPath: 'parameter',
}
const explicitHistories: Array<UpperHistory> = [
  2572, 2599, 2647, 2710, 2797, 2906, 3018, 3205,
].map((site) => ({ ...baseHistory, site }))
explicitHistories.push(
  { ...baseHistory, site: 3107, id: 'explicit-refetch-changed-application' },
  {
    ...baseHistory,
    site: 3107,
    id: 'explicit-refetch-empty-diff-application',
    initialName: 'Same',
    authoritativeName: 'Same',
  },
)
const refreshHistories: Array<UpperHistory> = mutationRefreshHistoryGrammar.map(
  (h) => ({
    ...baseHistory,
    ...h,
    site:
      h.invocation === 'external-handler-overlap'
        ? 3321
        : h.invocation === 'external-persisted-application-overlap'
          ? 3437
          : h.invocation === 'captured-handler-collection'
            ? 3720
            : 3607,
  }),
)
const identityHistories: Array<UpperHistory> =
  handlerCollectionHistoryGrammar.map((h) => ({
    ...baseHistory,
    ...h,
    site: 3962,
  }))
const fact = (checkpoint: string, value: unknown): Observation => ({
  checkpoint,
  value,
})

/** The wait-for graph has no publication edge while a mutation persists. A
 * fetch settlement therefore discharges refresh, and the later application
 * settlement separately discharges publication. */
function phaseModel(
  fetch: 'fulfilled' | 'rejected' = 'fulfilled',
  throwOnError = true,
) {
  let model: MutationRefreshLivenessModel = {
    fetch: 'pending',
    application: 'unaccepted',
    boundary: 'fetch',
    throwOnError,
  }
  model = reduceMutationRefreshLiveness(model, { type: 'accept-application' })
  model = reduceMutationRefreshLiveness(model, {
    type: 'settle-fetch',
    outcome: fetch,
  })
  const held = observeMutationRefreshLiveness(model)
  model = reduceMutationRefreshLiveness(model, {
    type: 'settle-application',
    outcome: 'fulfilled',
  })
  return { held, applied: observeMutationRefreshLiveness(model) }
}
function explicitModel(h: UpperHistory): Array<Observation> {
  const phase = phaseModel(
    h.site === 2710 ? 'rejected' : 'fulfilled',
    h.site !== 2710,
  )
  if (h.site === 2572) {
    const model = reduceExplicitRefetchApplication(
      { calls: new Map(), publicValues: new Map() },
      { type: 'start-call', callId: 1, resultIds: [], throwOnError: true },
    )
    return [
      fact('queryCalls', 0),
      fact('application', observeExplicitRefetchApplication(model, 1)),
      fact('results', []),
    ]
  }
  if (h.site === 2599) {
    let model = reduceExplicitRefetchApplication(
      { calls: new Map(), publicValues: new Map([['query', 'Before']]) },
      {
        type: 'start-call',
        callId: 1,
        resultIds: ['query'],
        throwOnError: true,
      },
    )
    model = reduceExplicitRefetchApplication(model, {
      type: 'accept-result',
      callId: 1,
      resultId: 'query',
      value: 'After',
    })
    model = reduceExplicitRefetchApplication(model, {
      type: 'fulfill-application',
      callId: 1,
      resultId: 'query',
    })
    return [
      fact('application', observeExplicitRefetchApplication(model, 1)),
      fact('query-data', 'After'),
    ]
  }
  if (h.site === 2647) {
    let model = createRefetchCallSettlementModel(['first', 'second'], true)
    model = reduceRefetchCallSettlement(model, {
      type: 'accept-application',
      queryId: 'first',
      applicationId: 'first-result',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'remove-query',
      queryId: 'second',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'settle-fetch',
      queryId: 'first',
      outcome: 'fulfilled',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'settle-application',
      applicationId: 'first-result',
      outcome: 'fulfilled',
    })
    return [fact('call', observeRefetchCallSettlement(model))]
  }
  if (h.site === 2710)
    return [
      fact('fetch-complete', { fetches: 2, isFetching: false }),
      fact('held', phase.held),
      fact('held-row', 'Optimistic'),
      fact('applied', phase.applied),
      fact('result-count', 1),
      fact('fetch-error', true),
    ]
  if (h.site === 2797) {
    let model = reduceExplicitRefetchApplication(
      {
        calls: new Map(),
        publicValues: new Map([
          ['detail', detailOnly.name],
          ['list', listOnly.name],
        ]),
      },
      {
        type: 'start-call',
        callId: 1,
        resultIds: ['detail', 'list'],
        throwOnError: true,
      },
    )
    model = reduceExplicitRefetchApplication(model, {
      type: 'accept-result',
      callId: 1,
      resultId: 'list',
      value: 'List refreshed',
    })
    model = reduceExplicitRefetchApplication(model, {
      type: 'fulfill-application',
      callId: 1,
      resultId: 'list',
    })
    const intermediate = observeExplicitRefetchApplication(model, 1)
    model = reduceExplicitRefetchApplication(model, {
      type: 'accept-result',
      callId: 1,
      resultId: 'detail',
      value: 'Detail refreshed',
    })
    model = reduceExplicitRefetchApplication(model, {
      type: 'fulfill-application',
      callId: 1,
      resultId: 'detail',
    })
    return [
      fact('fetch-started', 4),
      fact('list-applied', 'List refreshed'),
      fact('list-publication', intermediate),
      fact(
        'aggregate-publication',
        observeExplicitRefetchApplication(model, 1),
      ),
    ]
  }
  if (h.site === 2906) {
    let model = createRefetchCallSettlementModel(['query'], true)
    model = reduceRefetchCallSettlement(model, {
      type: 'accept-application',
      queryId: 'query',
      applicationId: 'own-result',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'accept-application',
      queryId: 'query',
      applicationId: 'background-result',
      source: 'background',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'settle-application',
      applicationId: 'own-result',
      outcome: 'fulfilled',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'settle-fetch',
      queryId: 'query',
      outcome: 'fulfilled',
    })
    model = reduceRefetchCallSettlement(model, {
      type: 'settle-application',
      applicationId: 'background-result',
      outcome: 'rejected',
    })
    return [
      fact('background-injected', true),
      fact('pre-background-row', 'Own result'),
      fact('call-outcome', observeRefetchCallSettlement(model).refetch),
      fact('result-count', 1),
      fact('successor-row', 'Successor'),
    ]
  }
  if (h.site === 3018)
    return [
      fact('initial-scan-started', 1),
      fact('parallel-scan-started', 2),
      fact('application-failure', {
        outcome: 'rejected',
        errorIsAuthored: true,
      }),
      fact('list-applied', 'Refreshed list'),
    ]
  if (h.site === 3107)
    return [
      fact('fetch-complete', { fetches: 2, updates: 2, isFetching: false }),
      fact('held', phase.held),
      fact('applied', phase.applied),
      fact('applied-row', h.authoritativeName),
    ]
  if (h.site === 3205)
    return [
      fact('peer-fetch-started', 2),
      fact('explicit-fetch-started', 3),
      fact('fetch-complete', false),
      fact('held', phase.held),
      fact('applied', phase.applied),
      fact('result-order', ['query']),
      fact('applied-row', 'Authoritative'),
    ]
  throw Error('Unknown explicit-refetch history')
}

/** Invocation identity selects a production path, not a different phase law.
 * The phase model predicts the same cut for captured, parameter and external
 * references, including refresh-first schedules. */
function refreshModel(h: UpperHistory): Array<Observation> {
  const phase = phaseModel()
  if (h.site === 3321)
    return [
      ...(h.schedule === 'refresh-first-during-fetch'
        ? [fact('refresh-started', 2)]
        : []),
      fact('fetch-complete', { fetches: 2, isFetching: false }),
      fact('held', phase.held),
      fact('applied', phase.applied),
      fact('applied-row', 'Authoritative'),
    ]
  if (h.site === 3437)
    return [
      fact('initial-scan-started', { fetches: 1, scans: 1 }),
      fact('refresh-started', 2),
      fact('application-preparing', { isFetching: false, scans: 2 }),
      fact('refresh-settled', phase.held.refresh),
      fact('held-row-is-source', false),
      fact('source-applied', 'Authoritative'),
      fact('applied', phase.applied),
    ]
  return [
    fact('refresh-started', 2),
    fact('fetch-complete', false),
    fact('held', phase.held),
  ]
}
function identityModel(h: UpperHistory): Array<Observation> {
  const pending = observeHandlerRefetchBoundary({
    fetch: 'pending',
    application: 'unaccepted',
    throwOnError: true,
  })
  const fetched = observeHandlerRefetchBoundary({
    fetch: 'fulfilled',
    application: 'pending',
    throwOnError: true,
  })
  const names =
    h.handlerKind === 'insert'
      ? ['First', 'Second', 'Server inserted first', 'Server inserted second']
      : h.handlerKind === 'update'
        ? ['Server updated first', 'Server updated second']
        : []
  return [
    fact('refresh-started', 2),
    fact('handler-before-result', pending.refetch),
    fact('handler-identity', observeHandlerIdentity(h, 2)),
    fact('handler-refetch-settled', fetched.refetch),
    fact('published-names', names.sort()),
  ]
}
function workModel(h: UpperHistory): Array<Observation> {
  return h.site === 3820
    ? [
        fact(
          'foreign-work',
          observeQueryCacheWork({
            collectionCount: 2,
            queryOwnership: 'foreign',
          }),
        ),
      ]
    : [
        fact('cancelled-fetch-started', 2),
        fact(
          'cancelled-record-work',
          observeFetchRecordSuccessorWork({ state: 'cancelled' }),
        ),
      ]
}

async function driver2572(history: UpperHistory, emit: Emit): Promise<void> {
  const { collection, queryFn } = createOwnershipFixture({
    id: `explicit-refetch-empty-aggregate`,
    results: [],
    syncMode: `on-demand`,
  })

  const results = await collection.utils.refetch({ throwOnError: true })

  emit('queryCalls', queryFn.mock.calls.length)
  emit('application', {
    publicValues: {},
    refetch: `resolved`,
    resultOrder: [],
  })
  emit('results', results)
}

async function driver2599(history: UpperHistory, emit: Emit): Promise<void> {
  const before = { ...shared, name: `Before` }
  const after = { ...shared, name: `After` }
  const { collection } = createOwnershipFixture({
    id: `explicit-refetch-unsubscribed-on-demand`,
    results: [[before], [after]],
    syncMode: `on-demand`,
  })
  await collection._sync.loadSubset({})
  const subscription = collection.subscribeChanges(() => {})
  subscription.unsubscribe()

  const results = await collection.utils.refetch({ throwOnError: true })

  emit('application', {
    publicValues: { query: collection.get(shared.id)?.name },
    refetch: `resolved`,
    resultOrder: [`query`],
  })
  emit('query-data', (results[0]?.data as Array<Item>)[0]?.name)
}

async function driver2647(history: UpperHistory, emit: Emit): Promise<void> {
  const queryClient = createQueryClient()
  const first = { limit: 1 }
  const second = { limit: 2 }
  let unloadSecond = () => {}
  let call = 0
  const queryFn = vi.fn(() => {
    call++
    if (call === 3) unloadSecond()
    return Promise.resolve([
      { id: String(call), category: `query`, name: `Call ${call}` },
    ])
  })
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id: `refetch-removes-later-query`,
      queryClient,
      queryKey: [`refetch-removes-later-query`],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
    }),
  )
  unloadSecond = () => collection._sync.unloadSubset(second)
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
  })
  await collection._sync.loadSubset(first)
  await collection._sync.loadSubset(second)

  const results = await collection.utils.refetch({ throwOnError: true })

  emit('call', {
    refetch: `resolved`,
    resultOrder: results.map((result, index) =>
      result === undefined ? undefined : index === 0 ? `first` : `second`,
    ),
  })
}

async function driver2710(history: UpperHistory, emit: Emit): Promise<void> {
  const initial = { ...shared, name: `Initial` }
  const fetchError = new Error(`Explicit refetch fetch failed`)
  const queryClient = createQueryClient()
  const queryFn = vi
    .fn<() => Promise<Array<Item>>>()
    .mockResolvedValueOnce([initial])
    .mockRejectedValueOnce(fetchError)
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id: `explicit-refetch-suppressed-fetch-failure`,
      queryClient,
      queryKey: [`explicit-refetch-suppressed-fetch-failure`],
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
    }),
  )
  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  cleanups.push(async () => {
    persistence.resolve()
    await transaction.when(`settled`).catch(() => undefined)
    consoleError.mockRestore()
    await collection.cleanup()
    queryClient.clear()
  })
  await collection.stateWhenReady()
  transaction.mutate(() => {
    collection.update(shared.id, (draft) => {
      draft.name = `Optimistic`
    })
  })

  let actualOutcome: RefetchApplicationOutcome = `pending`
  const refetch = collection.utils.refetch({ throwOnError: false }).then(
    (result) => {
      actualOutcome = `resolved`
      return result
    },
    (error: unknown) => {
      actualOutcome = `rejected`
      throw error
    },
  )
  void refetch.catch(() => undefined)
  if (
    !(await recordBoundary(
      'fetch-complete',
      () => ({
        fetches: queryFn.mock.calls.length,
        isFetching: collection.utils.isFetching,
      }),
      (v) => v.fetches === 2 && !v.isFetching,
      emit,
    ))
  )
    return

  for (let turn = 0; turn < 20; turn++) await Promise.resolve()
  emit('held', { refresh: actualOutcome, application: `pending` })
  emit('held-row', collection.get(shared.id)?.name)

  persistence.resolve()
  await transaction.when(`settled`)
  const results = await refetch

  emit('applied', { refresh: actualOutcome, application: `resolved` })
  emit('result-count', results.length)
  emit('fetch-error', results[0]?.isError)
}

async function driver2797(history: UpperHistory, emit: Emit): Promise<void> {
  const firstRefresh = createDeferred<Array<Item>>()
  const secondRefresh = createDeferred<Array<Item>>()
  const refreshedDetail = { ...detailOnly, name: `Detail refreshed` }
  const refreshedList = { ...listOnly, name: `List refreshed` }
  const { collection, queryFn } = createOwnershipFixture({
    id: `explicit-refetch-aggregate-order`,
    results: [
      [detailOnly],
      [listOnly],
      firstRefresh.promise,
      secondRefresh.promise,
    ],
  })
  cleanups.push(() => {
    firstRefresh.resolve([refreshedDetail])
    secondRefresh.resolve([refreshedList])
    return Promise.resolve()
  })
  const detail = { where: eq(new IR.PropRef([`category`]), `detail`) }
  const list = { where: eq(new IR.PropRef([`category`]), `list`) }
  await collection._sync.loadSubset(detail)
  await collection._sync.loadSubset(list)

  let refetchOutcome: RefetchApplicationOutcome = `pending`
  const refetch = collection.utils.refetch({ throwOnError: true }).then(
    (results) => {
      refetchOutcome = `resolved`
      return results
    },
    (error: unknown) => {
      refetchOutcome = `rejected`
      throw error
    },
  )
  void refetch.catch(() => {})
  if (
    !(await recordBoundary(
      'fetch-started',
      () => queryFn.mock.calls.length,
      (v) => v === 4,
      emit,
    ))
  )
    return

  secondRefresh.resolve([refreshedList])
  if (
    !(await recordBoundary(
      'list-applied',
      () => collection.get(listOnly.id)?.name,
      (v) => v === 'List refreshed',
      emit,
    ))
  )
    return

  emit('list-publication', {
    publicValues: {
      detail: collection.get(detailOnly.id)?.name,
      list: collection.get(listOnly.id)?.name,
    },
    refetch: refetchOutcome,
  })

  firstRefresh.resolve([refreshedDetail])
  const results = await refetch

  emit('aggregate-publication', {
    publicValues: {
      detail: collection.get(detailOnly.id)?.name,
      list: collection.get(listOnly.id)?.name,
    },
    refetch: refetchOutcome,
    resultOrder: results.map((result) => {
      return result && Array.isArray(result.data)
        ? (result.data[0] as Item | undefined)?.category
        : undefined
    }),
  })
}

async function driver2906(history: UpperHistory, emit: Emit): Promise<void> {
  const id = `explicit-refetch-excludes-background-application`
  const queryKey = [id] as const
  const initial = { ...shared, name: `Initial` }
  const ownResult = { ...shared, name: `Own result` }
  const background = { ...shared, name: `Background` }
  const successor = { ...shared, name: `Successor` }
  const queryClient = createQueryClient()
  const queryFn = vi
    .fn<() => Promise<Array<Item>>>()
    .mockResolvedValueOnce([initial])
    .mockResolvedValueOnce([ownResult])
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey,
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
    }),
  )
  const persistence = createDeferred<void>()
  let transaction: ReturnType<typeof createTransaction> | undefined
  let armed = false
  let backgroundInjected = false
  let nameBeforeBackground: string | undefined
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (
      armed &&
      event.type === `updated` &&
      event.action.type === `success` &&
      !event.action.manual
    ) {
      armed = false
      nameBeforeBackground = collection.get(shared.id)?.name
      transaction = createTransaction({
        mutationFn: () => persistence.promise,
      })
      transaction.mutate(() => {
        collection.update(shared.id, (draft) => {
          draft.name = `Optimistic`
        })
      })
      queryClient.setQueryData(queryKey, [background])
      backgroundInjected = true
    }
  })
  cleanups.push(async () => {
    unsubscribeCache()
    persistence.resolve()
    await transaction?.when(`settled`).catch(() => undefined)
    await collection.cleanup()
    queryClient.clear()
  })
  await collection.stateWhenReady()

  armed = true
  let actualOutcome: RefetchApplicationOutcome = `pending`
  const refetch = collection.utils.refetch({ throwOnError: true }).then(
    (results) => {
      actualOutcome = `resolved`
      return results
    },
    (error: unknown) => {
      actualOutcome = `rejected`
      throw error
    },
  )
  void refetch.catch(() => undefined)
  if (
    !(await recordBoundary(
      'background-injected',
      () => backgroundInjected,
      (v) => v === true,
      emit,
    ))
  )
    return
  emit('pre-background-row', nameBeforeBackground)

  queryClient.setQueryData(queryKey, [successor])

  persistence.resolve()
  await transaction?.when(`settled`)
  const results = await refetch

  emit('call-outcome', actualOutcome)
  emit('result-count', results.length)
  emit('successor-row', collection.get(shared.id)?.name)
}

async function driver3018(history: UpperHistory, emit: Emit): Promise<void> {
  const id = `explicit-refetch-fail-fast`
  const detail = { where: eq(new IR.PropRef([`category`]), `detail`) }
  const list = { where: eq(new IR.PropRef([`category`]), `list`) }
  const listKey = [id, getLoadSubsetDemandKey(list)]
  const invalidDetail = { ...detailOnly, name: `Invalid detail` }
  const refreshedList = { ...listOnly, name: `Refreshed list` }
  const applicationError = new Error(`Detail application failed`)
  const pendingListScan =
    createDeferred<
      Array<{ key: string | number; value: Item; metadata?: unknown }>
    >()
  const scanPersistedRows = vi.fn(() => pendingListScan.promise)
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const { collection } = createOwnershipFixture({
    id,
    results: [[detailOnly], [listOnly], [invalidDetail], [refreshedList]],
    getKey: (item) => {
      if (item.name === invalidDetail.name) throw applicationError
      return item.id
    },
    scanPersistedRows,
    setupMetadata: (metadata) => {
      const queryHash = hashKey(listKey)
      metadata.collection.set(`queryCollection:gc:${queryHash}`, {
        queryHash,
        mode: `until-revalidated`,
      })
    },
  })
  cleanups.push(() => {
    pendingListScan.resolve([])
    consoleError.mockRestore()
    return Promise.resolve()
  })
  await collection._sync.loadSubset(detail)
  const initialListLoad = Promise.resolve(collection._sync.loadSubset(list))
  void initialListLoad.catch(() => undefined)
  if (
    !(await recordBoundary(
      'initial-scan-started',
      () => scanPersistedRows.mock.calls.length,
      (v) => v === 1,
      emit,
    ))
  )
    return

  const refetch = collection.utils.refetch({ throwOnError: true })
  void refetch.catch(() => undefined)
  if (
    !(await recordBoundary(
      'parallel-scan-started',
      () => scanPersistedRows.mock.calls.length,
      (v) => v === 2,
      emit,
    ))
  )
    return
  const receipt = await settled(refetch)
  emit('application-failure', {
    outcome: receipt.outcome,
    errorIsAuthored:
      receipt.outcome === 'rejected' && receipt.error === applicationError,
  })

  pendingListScan.resolve([])
  await initialListLoad.catch(() => undefined)

  if (
    !(await recordBoundary(
      'list-applied',
      () => collection.get(listOnly.id)?.name,
      (v) => v === 'Refreshed list',
      emit,
    ))
  )
    return
}

async function driver3107(history: UpperHistory, emit: Emit): Promise<void> {
  const { id, initialName, authoritativeName } = history

  const initial = { ...shared, name: initialName }
  const authoritative = { ...shared, name: authoritativeName }
  const { collection, queryClient, queryFn } = createOwnershipFixture({
    id,
    results: [[initial], [authoritative]],
    syncMode: `eager`,
  })
  await collection.stateWhenReady()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => {
    collection.update(shared.id, (draft) => {
      draft.name = `Optimistic`
    })
  })
  cleanups.push(async () => {
    persistence.resolve()
    await transaction.when(`settled`)
  })

  let refetchOutcome: RefetchApplicationOutcome = `pending`
  const refetch = collection.utils.refetch({ throwOnError: true }).then(
    (result) => {
      refetchOutcome = `resolved`
      return result
    },
    (error: unknown) => {
      refetchOutcome = `rejected`
      throw error
    },
  )
  void refetch.catch(() => {})

  if (
    !(await recordBoundary(
      'fetch-complete',
      () => ({
        fetches: queryFn.mock.calls.length,
        updates: queryClient
          .getQueryCache()
          .find({ queryKey: [id], exact: true })?.state.dataUpdateCount,
        isFetching: collection.utils.isFetching,
      }),
      (v) => v.fetches === 2 && v.updates === 2 && !v.isFetching,
      emit,
    ))
  )
    return

  for (let turn = 0; turn < 20; turn++) await Promise.resolve()

  emit('held', {
    refresh: refetchOutcome,
    application:
      collection.get(shared.id)?.name === authoritative.name
        ? `resolved`
        : `pending`,
  })

  persistence.resolve()
  await transaction.when(`settled`)
  await refetch

  emit('applied', { refresh: refetchOutcome, application: `resolved` })
  emit('applied-row', collection.get(shared.id)?.name)
}

async function driver3205(history: UpperHistory, emit: Emit): Promise<void> {
  const queryClient = createQueryClient()
  const concurrentResult = createDeferred<Array<Item>>()
  const explicitResult = createDeferred<Array<Item>>()
  const persistence = createDeferred<void>()
  const initial = { ...shared, name: `Initial` }
  const authoritative = { ...shared, name: `Authoritative` }
  let call = 0
  const queryFn = vi.fn(() => {
    call++
    if (call === 1) return Promise.resolve([initial])
    if (call === 2) return concurrentResult.promise
    return explicitResult.promise
  })
  const eager = createCollection(
    queryCollectionOptions<Item>({
      id: `authority-gated-eager-refetch`,
      queryClient,
      queryKey: [`shared-refetch-authority`],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `eager`,
      startSync: true,
    }),
  )
  const onDemand = createCollection(
    queryCollectionOptions<Item>({
      id: `authority-gated-on-demand-writer`,
      queryClient,
      queryKey: [`shared-refetch-authority`],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
    }),
  )
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  let transactionStarted = false
  cleanups.push(async () => {
    concurrentResult.resolve([authoritative])
    explicitResult.resolve([authoritative])
    persistence.resolve()
    if (transactionStarted) {
      await transaction.when(`settled`).catch(() => undefined)
    }
    await Promise.allSettled([eager.cleanup(), onDemand.cleanup()])
    queryClient.clear()
  })
  await eager.stateWhenReady()
  await onDemand._sync.loadSubset({})

  transactionStarted = true
  transaction.mutate(() => {
    eager.update(shared.id, (draft) => {
      draft.name = `Optimistic`
    })
  })
  onDemand.utils.writeUpdate({ ...shared, name: `Manual` })
  void onDemand.utils.refetch({ throwOnError: true }).catch(() => {})
  if (
    !(await recordBoundary(
      'peer-fetch-started',
      () => queryFn.mock.calls.length,
      (v) => v === 2,
      emit,
    ))
  )
    return

  let refetchOutcome: RefetchApplicationOutcome = `pending`
  const refetch = eager.utils.refetch({ throwOnError: true }).then(
    (results) => {
      refetchOutcome = `resolved`
      return results
    },
    (error: unknown) => {
      refetchOutcome = `rejected`
      throw error
    },
  )
  void refetch.catch(() => undefined)
  if (
    !(await recordBoundary(
      'explicit-fetch-started',
      () => queryFn.mock.calls.length,
      (v) => v === 3,
      emit,
    ))
  )
    return

  explicitResult.resolve([authoritative])
  if (
    !(await recordBoundary(
      'fetch-complete',
      () => eager.utils.isFetching,
      (v) => v === false,
      emit,
    ))
  )
    return
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()

  emit('held', {
    refresh: refetchOutcome,
    application:
      eager.get(shared.id)?.name === authoritative.name
        ? `resolved`
        : `pending`,
  })

  persistence.resolve()
  await transaction.when(`settled`)
  const results = await refetch

  emit('applied', { refresh: refetchOutcome, application: `resolved` })
  emit(
    'result-order',
    results.map(() => `query`),
  )
  emit('applied-row', eager.get(shared.id)?.name)
}

async function driver3321(history: UpperHistory, emit: Emit): Promise<void> {
  const { legacyOperation, schedule } = history

  const initial = { ...shared, name: `Initial` }
  const authoritative = { ...shared, name: `Authoritative` }
  const refreshResult = createDeferred<Array<Item>>()
  const handlerStarted = createDeferred<void>()
  const releaseHandler = createDeferred<void>()
  const queryClient = createQueryClient()
  const queryFn = vi
    .fn<() => Promise<Array<Item>>>()
    .mockResolvedValueOnce([initial])
    .mockReturnValueOnce(refreshResult.promise)
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id: `external-${legacyOperation}-${schedule}-overlaps-handler`,
      queryClient,
      queryKey: [`external-${legacyOperation}-${schedule}-overlaps-handler`],
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
      onUpdate: async () => {
        handlerStarted.resolve()
        await releaseHandler.promise
      },
    }),
  )
  cleanups.push(async () => {
    refreshResult.resolve([authoritative])
    releaseHandler.resolve()
    await collection.cleanup()
    queryClient.clear()
  })
  await collection.stateWhenReady()

  let refetchOutcome: RefetchApplicationOutcome = `pending`
  const startRefresh = () => {
    const refresh = collection.utils.refetch({ throwOnError: true }).then(
      (result) => {
        refetchOutcome = `resolved`
        return result
      },
      (error: unknown) => {
        refetchOutcome = `rejected`
        throw error
      },
    )
    void refresh.catch(() => {})
    return refresh
  }
  const startMutation = () =>
    collection.update(shared.id, (draft) => {
      draft.name = `Optimistic`
    })

  let mutation: ReturnType<typeof startMutation>
  let refresh: ReturnType<typeof startRefresh>
  if (schedule === `mutation-first`) {
    mutation = startMutation()
    await handlerStarted.promise
    refresh = startRefresh()
  } else {
    refresh = startRefresh()
    if (
      !(await recordBoundary(
        'refresh-started',
        () => queryFn.mock.calls.length,
        (v) => v === 2,
        emit,
      ))
    )
      return
    mutation = startMutation()
    await handlerStarted.promise
  }
  refreshResult.resolve([authoritative])
  if (
    !(await recordBoundary(
      'fetch-complete',
      () => ({
        fetches: queryFn.mock.calls.length,
        isFetching: collection.utils.isFetching,
      }),
      (v) => v.fetches === 2 && !v.isFetching,
      emit,
    ))
  )
    return

  for (let turn = 0; turn < 20; turn++) await Promise.resolve()

  emit('held', {
    refresh: refetchOutcome,
    application:
      collection.get(shared.id)?.name === authoritative.name
        ? `resolved`
        : `pending`,
  })

  releaseHandler.resolve()
  await mutation.when(`settled`)
  await refresh

  emit('applied', { refresh: refetchOutcome, application: `resolved` })
  emit('applied-row', collection.get(shared.id)?.name)
}

async function driver3437(history: UpperHistory, emit: Emit): Promise<void> {
  const { legacyOperation } = history

  const id = `external-${legacyOperation}-persisted-application-overlap`
  const queryHash = hashKey([id])
  const initial = { ...shared, name: `Initial` }
  const authoritative = { ...shared, name: `Authoritative` }
  const optimistic = {
    id: `optimistic`,
    category: `mutation`,
    name: `Optimistic`,
  }
  const initialScan =
    createDeferred<
      Array<{ key: string | number; value: Item; metadata?: unknown }>
    >()
  const applicationScan =
    createDeferred<
      Array<{ key: string | number; value: Item; metadata?: unknown }>
    >()
  const refreshResult = createDeferred<Array<Item>>()
  const persistence = createDeferred<void>()
  const scanPersistedRows = vi
    .fn()
    .mockReturnValueOnce(initialScan.promise)
    .mockReturnValueOnce(applicationScan.promise)
  const { collection, queryFn } = createOwnershipFixture({
    id,
    syncMode: `eager`,
    results: [[initial], refreshResult.promise],
    scanPersistedRows,
    setupMetadata: (metadata) =>
      metadata.collection.set(`queryCollection:gc:${queryHash}`, {
        queryHash,
        mode: `until-revalidated`,
      }),
  })
  cleanups.push(() => {
    initialScan.resolve([])
    applicationScan.resolve([])
    refreshResult.resolve([authoritative])
    persistence.resolve()
    return Promise.resolve()
  })

  if (
    !(await recordBoundary(
      'initial-scan-started',
      () => ({
        fetches: queryFn.mock.calls.length,
        scans: scanPersistedRows.mock.calls.length,
      }),
      (v) => v.fetches === 1 && v.scans === 1,
      emit,
    ))
  )
    return

  let refetchOutcome: RefetchApplicationOutcome = `pending`
  const refresh = collection.utils.refetch({ throwOnError: true }).then(
    (result) => {
      refetchOutcome = `resolved`
      return result
    },
    (error: unknown) => {
      refetchOutcome = `rejected`
      throw error
    },
  )
  void refresh.catch(() => undefined)
  if (
    !(await recordBoundary(
      'refresh-started',
      () => queryFn.mock.calls.length,
      (v) => v === 2,
      emit,
    ))
  )
    return
  refreshResult.resolve([authoritative])
  if (
    !(await recordBoundary(
      'application-preparing',
      () => ({
        isFetching: collection.utils.isFetching,
        scans: scanPersistedRows.mock.calls.length,
      }),
      (v) => !v.isFetching && v.scans === 2,
      emit,
    ))
  )
    return

  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => collection.insert(optimistic))
  void transaction.when(`settled`).catch(() => undefined)
  applicationScan.resolve([])

  if (
    !(await recordBoundary(
      'refresh-settled',
      () => refetchOutcome,
      (v) => v === 'resolved',
      emit,
    ))
  )
    return
  emit(
    'held-row-is-source',
    collection.get(shared.id)?.name === authoritative.name,
  )

  persistence.resolve()
  await transaction.when(`settled`)
  await refresh

  if (
    !(await recordBoundary(
      'source-applied',
      () => collection.get(shared.id)?.name,
      (v) => v === 'Authoritative',
      emit,
    ))
  )
    return
  emit('applied', { refresh: refetchOutcome, application: `resolved` })
}

async function driver3607(history: UpperHistory, emit: Emit): Promise<void> {
  const { invocation, legacyOperation } = history

  const id = `mutation-refresh-${invocation}-${legacyOperation}`
  const initial = { ...shared, name: `Initial` }
  const authoritative = { ...shared, name: `Authoritative` }
  const refreshResult = createDeferred<Array<Item>>()
  const releaseMutation = createDeferred<void>()
  const queryClient = createQueryClient()
  const queryFn = vi
    .fn<() => Promise<Array<Item>>>()
    .mockResolvedValueOnce([initial])
    .mockReturnValueOnce(refreshResult.promise)
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
    }),
  )
  let refreshOutcome: RefetchApplicationOutcome = `pending`
  const mutationFn = async (): Promise<void> => {
    const refresh = collection.utils.refetch({ throwOnError: true })
    await refresh.then(
      () => {
        refreshOutcome = `resolved`
      },
      (error: unknown) => {
        refreshOutcome = `rejected`
        throw error
      },
    )
    await releaseMutation.promise
  }
  const transactionReference: {
    current?: Transaction<Record<string, unknown>>
  } = {}
  cleanups.push(async () => {
    refreshResult.resolve([authoritative])
    if (transactionReference.current) {
      // An immediate direct write drains the accepted sync result and
      // breaks the deliberately reproduced cycle during RED cleanup.
      collection.utils.writeUpdate(authoritative)
      releaseMutation.resolve()
      await transactionReference.current.when(`settled`)
    }
    await collection.cleanup()
    queryClient.clear()
  })
  await collection.stateWhenReady()

  let transaction: Transaction<Record<string, unknown>>
  if (invocation === `manual-transaction`) {
    transaction = createTransaction<Record<string, unknown>>({
      mutationFn,
    })
    transaction.mutate(() => {
      collection.update(shared.id, (draft) => {
        draft.name = `Optimistic`
      })
    })
  } else {
    const action = createOptimisticAction<string>({
      onMutate: () => {
        collection.update(shared.id, (draft) => {
          draft.name = `Optimistic`
        })
      },
      mutationFn: async () => mutationFn(),
    })
    transaction = action(`refresh`)
  }
  transactionReference.current = transaction
  void transaction.when(`settled`).catch(() => undefined)
  if (
    !(await recordBoundary(
      'refresh-started',
      () => queryFn.mock.calls.length,
      (v) => v === 2,
      emit,
    ))
  )
    return

  refreshResult.resolve([authoritative])
  if (
    !(await recordBoundary(
      'fetch-complete',
      () => collection.utils.isFetching,
      (v) => v === false,
      emit,
    ))
  )
    return
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()

  emit('held', {
    refresh: refreshOutcome,
    application:
      collection.get(shared.id)?.name === authoritative.name
        ? `resolved`
        : `pending`,
  })
}

async function driver3720(history: UpperHistory, emit: Emit): Promise<void> {
  const { legacyOperation } = history

  const id = `captured-handler-refresh-${legacyOperation}`
  const initial = { ...shared, name: `Initial` }
  const authoritative = { ...shared, name: `Authoritative` }
  const refreshResult = createDeferred<Array<Item>>()
  const releaseHandler = createDeferred<void>()
  const queryClient = createQueryClient()
  const queryFn = vi
    .fn<() => Promise<Array<Item>>>()
    .mockResolvedValueOnce([initial])
    .mockReturnValueOnce(refreshResult.promise)
  let refreshOutcome: RefetchApplicationOutcome = `pending`
  const collectionReference: { current?: OwnershipFixture[`collection`] } = {}
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
      onUpdate: async () => {
        const capturedCollection = collectionReference.current
        if (!capturedCollection) {
          throw new Error(`The captured Collection is not available`)
        }
        const refresh = capturedCollection.utils.refetch({
          throwOnError: true,
        })
        await refresh.then(
          () => {
            refreshOutcome = `resolved`
          },
          (error: unknown) => {
            refreshOutcome = `rejected`
            throw error
          },
        )
        await releaseHandler.promise
      },
    }),
  )
  collectionReference.current = collection
  const transactionReference: {
    current?: ReturnType<typeof collection.update>
  } = {}
  cleanups.push(async () => {
    refreshResult.resolve([authoritative])
    if (transactionReference.current) {
      collection.utils.writeUpdate(authoritative)
      releaseHandler.resolve()
      await transactionReference.current.when(`settled`)
    }
    await collection.cleanup()
    queryClient.clear()
  })
  await collection.stateWhenReady()

  const transaction = collection.update(shared.id, (draft) => {
    draft.name = `Optimistic`
  })
  transactionReference.current = transaction
  void transaction.when(`settled`).catch(() => undefined)
  if (
    !(await recordBoundary(
      'refresh-started',
      () => queryFn.mock.calls.length,
      (v) => v === 2,
      emit,
    ))
  )
    return

  refreshResult.resolve([authoritative])
  if (
    !(await recordBoundary(
      'fetch-complete',
      () => collection.utils.isFetching,
      (v) => v === false,
      emit,
    ))
  )
    return
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()

  emit('held', {
    refresh: refreshOutcome,
    application:
      collection.get(shared.id)?.name === authoritative.name
        ? `resolved`
        : `pending`,
  })
}

async function driver3820(history: UpperHistory, emit: Emit): Promise<void> {
  const queryClient = createQueryClient()
  const baselineClient = createQueryClient()
  const first = createCollection(
    queryCollectionOptions<Item>({
      id: `foreign-query-work-first`,
      queryClient,
      queryKey: [`foreign-query-work-first`],
      queryFn: () => Promise.resolve([]),
      getKey: (item) => item.id,
      startSync: true,
    }),
  )
  const second = createCollection(
    queryCollectionOptions<Item>({
      id: `foreign-query-work-second`,
      queryClient,
      queryKey: [`foreign-query-work-second`],
      queryFn: () => Promise.resolve([]),
      getKey: (item) => item.id,
      startSync: true,
    }),
  )
  await Promise.all([first.stateWhenReady(), second.stateWhenReady()])

  const nativeQueueMicrotask = globalThis.queueMicrotask
  let scheduledMicrotasks = 0
  const queueMicrotaskSpy = vi
    .spyOn(globalThis, `queueMicrotask`)
    .mockImplementation((callback) => {
      scheduledMicrotasks++
      nativeQueueMicrotask(callback)
    })
  cleanups.push(async () => {
    queueMicrotaskSpy.mockRestore()
    await Promise.all([first.cleanup(), second.cleanup()])
    queryClient.clear()
    baselineClient.clear()
  })

  const measureFetchMicrotasks = async (
    client: QueryClient,
    queryKey: ReadonlyArray<string>,
  ): Promise<number> => {
    scheduledMicrotasks = 0
    await client.fetchQuery({ queryKey, queryFn: () => Promise.resolve([]) })
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    return scheduledMicrotasks
  }
  const baseline = await measureFetchMicrotasks(baselineClient, [
    `baseline-foreign-query`,
  ])
  const withCollections = await measureFetchMicrotasks(queryClient, [
    `foreign-query`,
  ])

  emit('foreign-work', { collectionMicrotasks: withCollections - baseline })
}

async function driver3889(history: UpperHistory, emit: Emit): Promise<void> {
  const measureSuccessorFetchMicrotasks = async (
    cancelFirst: boolean,
  ): Promise<number> => {
    const id = `cancelled-fetch-record-${cancelFirst}`
    const initial = { ...shared, name: `Initial` }
    const authoritative = { ...shared, name: `Authoritative` }
    const cancelledResult = createDeferred<Array<Item>>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn<() => Promise<Array<Item>>>()
    queryFn.mockResolvedValueOnce([initial])
    if (cancelFirst) queryFn.mockReturnValueOnce(cancelledResult.promise)
    queryFn.mockResolvedValue([authoritative])
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )

    try {
      await collection.stateWhenReady()
      if (cancelFirst) {
        const cancelledRefetch = collection.utils.refetch({
          throwOnError: true,
        })
        if (
          !(await recordBoundary(
            'cancelled-fetch-started',
            () => queryFn.mock.calls.length,
            (v) => v === 2,
            emit,
          ))
        )
          throw new Error('The cancelled fetch did not start')
        await queryClient.cancelQueries({ queryKey: [id], exact: true })
        await cancelledRefetch
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
      }

      const nativeQueueMicrotask = globalThis.queueMicrotask
      let scheduledMicrotasks = 0
      const queueMicrotaskSpy = vi
        .spyOn(globalThis, `queueMicrotask`)
        .mockImplementation((callback) => {
          scheduledMicrotasks++
          nativeQueueMicrotask(callback)
        })
      try {
        await collection.utils.refetch({ throwOnError: true })
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
        return scheduledMicrotasks
      } finally {
        queueMicrotaskSpy.mockRestore()
      }
    } finally {
      cancelledResult.resolve([authoritative])
      await collection.cleanup()
      queryClient.clear()
    }
  }

  const baseline = await measureSuccessorFetchMicrotasks(false)
  const afterCancellation = await measureSuccessorFetchMicrotasks(true)

  emit('cancelled-record-work', {
    extraCleanupMicrotasks: afterCancellation - baseline,
  })
}

async function driver3962(history: UpperHistory, emit: Emit): Promise<void> {
  const { handlerKind, accessPath, legacyOperation } = history
  const initial = [
    { id: `first`, category: `shared`, name: `First` },
    { id: `second`, category: `shared`, name: `Second` },
  ]
  const inserted = [
    { id: `inserted-first`, category: `shared`, name: `Client first` },
    { id: `inserted-second`, category: `shared`, name: `Client second` },
  ]
  const authoritative =
    handlerKind === `insert`
      ? [
          ...initial,
          { ...inserted[0]!, name: `Server inserted first` },
          { ...inserted[1]!, name: `Server inserted second` },
        ]
      : handlerKind === `update`
        ? [
            { ...initial[0]!, name: `Server updated first` },
            { ...initial[1]!, name: `Server updated second` },
          ]
        : []
  const refresh = createDeferred<Array<Item>>()
  const queryClient = createQueryClient()
  const queryFn = vi
    .fn<() => Promise<Array<Item>>>()
    .mockResolvedValueOnce(initial)
    .mockReturnValueOnce(refresh.promise)
  const externalCollectionReference: { current?: object } = {}
  const inspectIdentity = createDeferred<void>()
  const externalTransactionReference: { current?: object } = {}
  let identityObservation: HandlerIdentityObservation | undefined
  let handlerOutcome: RefetchApplicationOutcome = `pending`
  const handleMutation = async (
    actualHandlerKind: MutationHandlerKind,
    handlerCollection: {
      utils: Pick<
        QueryCollectionUtils<Item, string | number, Item, unknown>,
        `refetch`
      >
    },
    transaction: {
      mutations: ReadonlyArray<{ collection: unknown }>
    },
  ): Promise<void> => {
    await inspectIdentity.promise
    const externalCollection = externalCollectionReference.current
    if (!externalCollection) {
      throw new Error(`The external Collection is not available`)
    }
    const externalTransaction = externalTransactionReference.current
    if (!externalTransaction) {
      throw new Error(`The external transaction is not available`)
    }
    const externalMutations = (externalTransaction as typeof transaction)
      .mutations
    const aliases = transaction.mutations.map(
      ({ collection: mutationCollection }) => mutationCollection as object,
    )
    const externalMap = new Map<object, string>([
      [externalCollection, `external`],
    ])
    const parameterMap = new Map<object, string>([
      [handlerCollection, `parameter`],
    ])
    const externalWeakMap = new WeakMap<object, string>([
      [externalCollection, `external`],
    ])
    const parameterWeakMap = new WeakMap<object, string>([
      [handlerCollection, `parameter`],
    ])
    identityObservation = {
      handlerKind: actualHandlerKind,
      accessPath,
      matchingAliasCount: aliases.length,
      transactionIsExternal: transaction === externalTransaction,
      allMutationsPreserveIdentity: transaction.mutations.every(
        (mutation, index) => mutation === externalMutations[index],
      ),
      parameterIsExternal: handlerCollection === externalCollection,
      allAliasesMatchParameter: aliases.every(
        (alias) => alias === handlerCollection,
      ),
      anyAliasMatchesExternal: aliases.some(
        (alias) => alias === externalCollection,
      ),
      externalMapMatchesAnyAlias: aliases.some((alias) =>
        externalMap.has(alias),
      ),
      parameterMapMatchesAllAliases: aliases.every((alias) =>
        parameterMap.has(alias),
      ),
      externalWeakMapMatchesAnyAlias: aliases.some((alias) =>
        externalWeakMap.has(alias),
      ),
      parameterWeakMapMatchesAllAliases: aliases.every((alias) =>
        parameterWeakMap.has(alias),
      ),
    }
    const refetchCollection =
      accessPath === `parameter`
        ? handlerCollection
        : (aliases[0] as typeof handlerCollection)
    const boundary = refetchCollection.utils.refetch({ throwOnError: true })
    await boundary.then(
      () => {
        handlerOutcome = `resolved`
      },
      (error: unknown) => {
        handlerOutcome = `rejected`
        throw error
      },
    )
  }
  const collection = createCollection(
    queryCollectionOptions<Item>({
      id: `handler-scope-${handlerKind}-${accessPath}-${legacyOperation}`,
      queryClient,
      queryKey: [`handler-scope`, handlerKind, accessPath, legacyOperation],
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
      onInsert: ({ transaction, collection: handlerCollection }) =>
        handleMutation(`insert`, handlerCollection, transaction),
      onUpdate: ({ transaction, collection: handlerCollection }) =>
        handleMutation(`update`, handlerCollection, transaction),
      onDelete: ({ transaction, collection: handlerCollection }) =>
        handleMutation(`delete`, handlerCollection, transaction),
    }),
  )
  externalCollectionReference.current = collection
  cleanups.push(async () => {
    inspectIdentity.resolve()
    refresh.resolve(authoritative)
    await collection.cleanup()
    queryClient.clear()
  })
  await collection.stateWhenReady()

  const mutation =
    handlerKind === `insert`
      ? collection.insert(inserted)
      : handlerKind === `update`
        ? collection.update(
            initial.map(({ id }) => id),
            (drafts) => {
              drafts[0]!.name = `Client updated first`
              drafts[1]!.name = `Client updated second`
            },
          )
        : collection.delete(initial.map(({ id }) => id))
  externalTransactionReference.current = mutation
  inspectIdentity.resolve()
  void mutation.when(`settled`).catch(() => undefined)
  if (
    !(await recordBoundary(
      'refresh-started',
      () => queryFn.mock.calls.length,
      (v) => v === 2,
      emit,
    ))
  )
    return
  emit('handler-before-result', handlerOutcome)
  if (!identityObservation) {
    throw new Error(`The mutation handler did not record Collection identity`)
  }
  emit('handler-identity', identityObservation)

  refresh.resolve(authoritative)

  if (
    !(await recordBoundary(
      'handler-refetch-settled',
      () => handlerOutcome,
      (v) => v === 'resolved',
      emit,
    ))
  )
    return

  await mutation.when(`settled`)

  emit(
    'published-names',
    [...collection.values()].map(({ name }) => name).sort(),
  )
}
const upperTitles: Record<number, string> = {
  '2572': 'resolves a refetch with no tracked Query results',
  '2599': 'applies a successful on-demand refetch without Query listeners',
  '2647': 'skips a snapshotted Query removed while an earlier refetch starts',
  '2710':
    'settles a suppressed fetch failure at the fetch boundary while a mutation persists',
  '2797': 'waits for every Query result and preserves tracked-key order',
  '2906': 'does not adopt a background application from the same Query',
  '3018': 'rejects before an independent accepted application settles',
  '3107':
    'settles a $caseName accepted result at fetch and applies it after mutation',
  '3205':
    'settles an eager refetch at fetch while another collection refetches',
  '3321':
    'settles an external refetch at fetch with $schedule overlap (legacy replay: $legacyOperation)',
  '3437':
    'settles an external refetch when mutation starts during persisted application preparation (legacy replay: $legacyOperation)',
  '3607':
    'settles a $invocation refetch at the fetch boundary (legacy replay: $legacyOperation)',
  '3720':
    'settles a captured handler Collection refetch at the fetch boundary (legacy replay: $legacyOperation)',
  '3820': 'does not schedule Collection work for a foreign Query',
  '3889':
    'does not defer reverted fetch record retirement to a successor fetch',
  '3962':
    'preserves $handlerKind handler identity through $accessPath refetch (legacy replay: $legacyOperation)',
}
function upperLabel(h: UpperHistory) {
  return upperTitles[h.site]!.replace(/\$(\w+)/g, (_match, key: string) =>
    key === 'caseName'
      ? h.initialName === 'Same'
        ? 'empty-diff'
        : 'changed'
      : String(h[key as keyof UpperHistory]),
  )
}
const driverBySite: Record<
  number,
  (h: UpperHistory, emit: Emit) => Promise<void>
> = {
  2572: driver2572,
  2599: driver2599,
  2647: driver2647,
  2710: driver2710,
  2797: driver2797,
  2906: driver2906,
  3018: driver3018,
  3107: driver3107,
  3205: driver3205,
  3321: driver3321,
  3437: driver3437,
  3607: driver3607,
  3720: driver3720,
  3820: driver3820,
  3889: driver3889,
  3962: driver3962,
}
async function observeUpper(h: UpperHistory, emit: Emit): Promise<void> {
  try {
    await driverBySite[h.site]!(h, emit)
  } finally {
    await runCleanups()
  }
}

/** These are the same finite authored paths and replay coordinates as the old
 * owner. Their models are unchanged reducers, and every old work, identity,
 * cache and public-row cut is emitted before cleanup. */
const commonAuthority =
  'docs/collections/query-collection.md#explicit-refetch-inside-a-handler and #utility-methods'
oracleProperty({
  id: 'query-db.ownership.explicit-refetch',
  law: {
    statement:
      'A public refetch observes its own tracked Query calls and applications, preserves key order, and uses the fetch boundary while a mutation persists.',
    authority: commonAuthority,
    limits:
      'The original 10 finite histories with controlled Query results, retained-scan holds and one real QueryClient; arbitrary polling, retry and external I/O remain separate paths.',
  },
  owns: ['src/query.ts#queryCollectionOptions'],
  histories: explicitHistories,
  label: upperLabel,
  model: explicitModel,
  driver: observeUpper,
  check: (_h, trace, expected) =>
    compareCuts(trace, expected, 'explicit refetch obligation'),
})
oracleProperty({
  id: 'query-db.ownership.refresh-overlap',
  law: {
    statement:
      'Every refetch overlapping persisting mutation work uses the Query fetch boundary, in either start order and through every captured Collection identity.',
    authority: commonAuthority,
    limits:
      'The original 12 finite invocation/schedule/replay cases; one mutation, one physical refresh and controlled local persistence preparation.',
  },
  owns: ['src/query.ts#queryCollectionOptions'],
  histories: refreshHistories,
  label: upperLabel,
  model: refreshModel,
  driver: observeUpper,
  check: (_h, trace, expected) =>
    compareCuts(trace, expected, 'mutation refresh boundary'),
})
oracleProperty({
  id: 'query-db.ownership.handler-identity',
  law: {
    statement:
      'Handler Collection, transaction and mutation aliases retain their external identity, and the handler refetch settles at its fetch boundary before publication.',
    authority: commonAuthority,
    limits:
      'The original 12 insert/update/delete, parameter/mutation-alias and legacy replay cases with two mutations in one direct handler.',
  },
  owns: ['src/query.ts#queryCollectionOptions'],
  histories: identityHistories,
  label: upperLabel,
  model: identityModel,
  driver: observeUpper,
  check: (_h, trace, expected) =>
    compareCuts(trace, expected, 'handler public identity'),
})
oracleProperty({
  id: 'query-db.ownership.work',
  law: {
    statement:
      'A foreign Query schedules no Collection cache work, and a cancelled fetch leaves no deferred cleanup work for its successor.',
    authority:
      'The ownership/cache-work and cancelled-fetch lifecycle laws documented in ownership-lifecycle.oracle.test.ts.',
    limits:
      'The original two deterministic microtask diagnostics after subtracting Query Core baseline work; these are work counts, not elapsed-time bounds.',
  },
  owns: ['src/query.ts#queryCollectionOptions'],
  histories: [
    { ...baseHistory, site: 3820 },
    { ...baseHistory, site: 3889 },
  ],
  label: upperLabel,
  model: workModel,
  driver: observeUpper,
  check: (_h, trace, expected) =>
    compareCuts(trace, expected, 'Query ownership work'),
  calibrations: [
    {
      name: 'foreign Query treated as owned',
      law: 'Query ownership work',
      corrupt: (trace, h) =>
        h.site === 3820
          ? trace.map((o) =>
              o.checkpoint === 'foreign-work'
                ? {
                    ...o,
                    value: observeQueryCacheWork({
                      collectionCount: 2,
                      queryOwnership: 'owned',
                    }),
                  }
                : o,
            )
          : undefined,
    },
    {
      name: 'cancelled record retained into successor',
      law: 'Query ownership work',
      corrupt: (trace, h) =>
        h.site === 3889
          ? trace.map((o) =>
              o.checkpoint === 'cancelled-record-work'
                ? {
                    ...o,
                    value: observeFetchRecordSuccessorWork({ state: 'active' }),
                  }
                : o,
            )
          : undefined,
    },
  ],
})

declareOracle({
  model: [phaseModel, explicitModel, refreshModel, identityModel, workModel],
  check: [compareCuts],
  grammar: [explicitHistories, refreshHistories, identityHistories],
})
