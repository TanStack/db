import {
  QueryClient,
  QueryObserver,
  focusManager,
  hashKey,
  isCancelledError,
} from '@tanstack/query-core'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src/index.js'
import { SyncNotInitializedError } from '../src/errors.js'
import { queryCollectionOptions } from '../src/query.js'
import type {
  Collection,
  LoadSubsetOptions,
  SyncMetadataApi,
} from '@tanstack/db'
import type { QueryFunctionContext } from '@tanstack/query-core'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src/index.js'
import type { NonSingleResult } from '../../db/src/types.js'
import type { QueryCollectionUtils } from '../src/query.js'

/**
 * # Who owns a Query-backed row, and when may it disappear?
 *
 * Query cache entries acquire rows for one or more exact subset demands. A row
 * remains public while any committed owner needs it. Provisional ownership
 * begins during result application, becomes durable only after publication and
 * persistence, and retires when superseded, canceled, cleaned up, or released.
 * Mutation refetches add a second authority path but do not bypass those rules.
 *
 * The reference view is an ownership graph: query scope and demand nodes point
 * to row keys; sync generations order competing results; publication
 * and persistence are separate commit boundaries. Tests use real QueryClient
 * observers, cache events, collection metadata, persisted scans, and live
 * queries. They compare source rows, derived rows, cache rows, metadata writes,
 * exact request lifetimes, and bounded refetch work at each boundary.
 *
 * The file is large because it crosses the real Query cache boundary, not
 * because it duplicates Query internals. Each history names one ownership edge
 * or generation race; shared fixtures provide the graph and observations.
 */

type Item = {
  id: string
  category: string
  name: string
}

type MutationLifecycleSnapshot = {
  server: Array<string>
  cache: Array<string>
  synced: Array<string>
  source: Array<string>
  derived: Array<string>
}

type MutationPublicationSnapshot = Pick<
  MutationLifecycleSnapshot,
  `source` | `derived`
> & { expected: Array<string> }

type MetadataRecorder = {
  rows: Map<string | number, unknown>
  writes: Array<{ type: `set` | `delete`; key: string | number }>
}

type OwnershipFixtureOptions = {
  id: string
  results: Array<Array<Item> | Promise<Array<Item>>>
  getKey?: (item: Item) => string | number
  syncMode?: `eager` | `on-demand`
  customHash?: boolean
  staleTime?: number
  metadataRecorder?: MetadataRecorder
  setupMetadata?: (metadata: SyncMetadataApi<string | number>) => void
  scanPersistedRows?: () => Promise<
    Array<{ key: string | number; value: Item; metadata?: unknown }>
  >
}

type OwnershipFixture = {
  collection: Collection<
    Item,
    string | number,
    QueryCollectionUtils<Item, string | number, Item, unknown>,
    never,
    Item
  > &
    NonSingleResult
  queryClient: QueryClient
  queryFn: ReturnType<typeof vi.fn<() => Promise<Array<Item>>>>
}

const shared = { id: `shared`, category: `shared`, name: `Shared` }
const detailOnly = { id: `detail`, category: `detail`, name: `Detail` }
const listOnly = { id: `list`, category: `list`, name: `List` }
const cleanups: Array<() => Promise<void>> = []

async function runCleanups(): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.splice(0).map((cleanup) => cleanup()),
  )
  const failures = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, `Ownership oracle cleanup failed`, {
      cause: failures[0],
    })
  }
}

/**
 * `collection.utils.refetch()` is an application barrier. The public contract
 * is `docs/collections/query-collection.md#controlling-refetch-behavior`:
 * outside a mutation handler, successful fulfillment waits for every result
 * accepted for Collection application, including an application with no row
 * diff. Rejection is fail-fast and may leave independent obligations pending.
 * The handler receives a scoped Collection view whose refetch keeps the Query
 * fetch boundary so it cannot await the transaction that invoked the handler.
 *
 * Model mapping:
 * - `callId` and `resultId` are model-only identities for one public call and
 *   its ordered Query results; they are not production generation counters.
 * - `accept-result` means the observer result has an exact application promise.
 * - `fulfill-application` and `reject-application` mean that promise settled.
 * - `retire-application` means cancellation or supersession won before the
 *   application no-cancel point and therefore rejects that exact obligation.
 * - `publicValues` represents Collection rows at the public checkpoint.
 * - `RefetchCallSettlementModel` splits each tracked Query fetch from the zero
 *   or more Collection applications it accepts while that fetch is active.
 * - `HandlerRefetchBoundaryModel` excludes the causally queued Collection
 *   application from the handler call while retaining its later error record.
 *
 * Results skipped before application because refresh is deferred, or because a
 * manual-write snapshot is unchanged, are outside this accepted-result model.
 * Invalid query shapes remain the input-validation contract in `query.test.ts`.
 *
 * State minimality: result order is observable in the returned array; pending
 * result identity controls call settlement; accepted values control publication;
 * `throwOnError` distinguishes rejection from suppressed failure; separate calls
 * retain the outcome of a superseded caller.
 *
 * ORC review record for this extension: ORC-001, 002, 003, 005, 006, 008, 009,
 * 010, and 012 apply and are evidenced by this prose, independent reducer,
 * fixed action histories, real drivers, observation helper, wrong-result
 * control, state explanation, mapping, and aggregate cleanup. ORC-004 and 007
 * do not apply because these are bounded fixed histories, not generated-property
 * coverage. ORC-011 does not apply because no shared production/model semantic
 * fault requiring a second formulation is claimed.
 */
type RefetchApplicationOutcome = `pending` | `resolved` | `rejected`

type ExplicitRefetchCallModel = {
  resultOrder: Array<string>
  pendingResultIds: Set<string>
  acceptedValues: Map<string, string>
  throwOnError: boolean
  outcome: RefetchApplicationOutcome
}

type ExplicitRefetchApplicationModel = {
  calls: Map<number, ExplicitRefetchCallModel>
  publicValues: Map<string, string>
}

type ExplicitRefetchApplicationAction =
  | {
      type: `start-call`
      callId: number
      resultIds: Array<string>
      throwOnError: boolean
    }
  | {
      type: `accept-result`
      callId: number
      resultId: string
      value: string
    }
  | { type: `fulfill-application`; callId: number; resultId: string }
  | { type: `reject-application`; callId: number; resultId: string }
  | { type: `retire-application`; callId: number; resultId: string }

type ExplicitRefetchObservation = {
  publicValues: Record<string, string | undefined>
  refetch: RefetchApplicationOutcome
  resultOrder?: Array<string>
}

function reduceExplicitRefetchApplication(
  model: ExplicitRefetchApplicationModel,
  action: ExplicitRefetchApplicationAction,
): ExplicitRefetchApplicationModel {
  if (action.type === `start-call`) {
    if (model.calls.has(action.callId)) {
      throw new Error(`Refetch call ${action.callId} already exists`)
    }
    if (new Set(action.resultIds).size !== action.resultIds.length) {
      throw new Error(
        `A refetch call cannot contain duplicate result identities`,
      )
    }
    const calls = new Map(model.calls)
    calls.set(action.callId, {
      resultOrder: [...action.resultIds],
      pendingResultIds: new Set(action.resultIds),
      acceptedValues: new Map(),
      throwOnError: action.throwOnError,
      outcome: action.resultIds.length === 0 ? `resolved` : `pending`,
    })
    return { ...model, calls }
  }

  const call = model.calls.get(action.callId)
  if (!call) throw new Error(`Unknown refetch call ${action.callId}`)
  if (!call.resultOrder.includes(action.resultId)) {
    throw new Error(`Unknown result ${action.resultId}`)
  }
  if (!call.pendingResultIds.has(action.resultId)) {
    throw new Error(`Result ${action.resultId} already settled`)
  }

  if (action.type === `accept-result`) {
    if (call.acceptedValues.has(action.resultId)) {
      throw new Error(`Result ${action.resultId} already accepted`)
    }
    const calls = new Map(model.calls)
    calls.set(action.callId, {
      ...call,
      acceptedValues: new Map(call.acceptedValues).set(
        action.resultId,
        action.value,
      ),
    })
    return { ...model, calls }
  }

  const acceptedValue = call.acceptedValues.get(action.resultId)
  if (acceptedValue === undefined) {
    throw new Error(`Cannot settle a result before it is accepted`)
  }

  const pendingResultIds = new Set(call.pendingResultIds)
  pendingResultIds.delete(action.resultId)
  const calls = new Map(model.calls)
  if (action.type === `fulfill-application`) {
    const publicValues = new Map(model.publicValues).set(
      action.resultId,
      acceptedValue,
    )
    calls.set(action.callId, {
      ...call,
      pendingResultIds,
      outcome:
        call.outcome === `rejected`
          ? `rejected`
          : pendingResultIds.size === 0
            ? `resolved`
            : `pending`,
    })
    return { calls, publicValues }
  }

  calls.set(action.callId, {
    ...call,
    pendingResultIds,
    outcome: call.throwOnError
      ? `rejected`
      : pendingResultIds.size === 0
        ? `resolved`
        : `pending`,
  })
  return { ...model, calls }
}

function observeExplicitRefetchApplication(
  model: ExplicitRefetchApplicationModel,
  callId: number,
): ExplicitRefetchObservation {
  const call = model.calls.get(callId)
  if (!call) throw new Error(`Unknown refetch call ${callId}`)
  return {
    publicValues: Object.fromEntries(
      call.resultOrder.map((resultId) => [
        resultId,
        model.publicValues.get(resultId),
      ]),
    ),
    refetch: call.outcome,
    ...(call.outcome === `resolved`
      ? { resultOrder: call.resultOrder }
      : undefined),
  }
}

function expectExplicitRefetchObservation(
  actual: ExplicitRefetchObservation,
  expected: ExplicitRefetchObservation,
): void {
  expect(actual).toEqual(expected)
}

/**
 * This model-only call ledger separates Query fetch settlement from every
 * accepted Collection application. One tracked Query may accept several
 * results while its fetch is active. A successful call waits for every fetch
 * and application obligation. A throwing call rejects at its first failure;
 * its other obligations may remain pending. This is the `Promise.all`
 * aggregate promised by the public utility, not an all-settled barrier.
 */
type RefetchCallSettlementModel = {
  queryOrder: Array<string>
  fetches: Map<string, `pending` | `fulfilled` | `rejected`>
  applications: Map<
    string,
    {
      queryId: string
      outcome: `pending` | `fulfilled` | `rejected`
    }
  >
  throwOnError: boolean
}

type RefetchCallSettlementAction =
  | { type: `accept-application`; queryId: string; applicationId: string }
  | {
      type: `settle-fetch`
      queryId: string
      outcome: `fulfilled` | `rejected`
    }
  | {
      type: `settle-application`
      applicationId: string
      outcome: `fulfilled` | `rejected`
    }

function createRefetchCallSettlementModel(
  queryOrder: Array<string>,
  throwOnError: boolean,
): RefetchCallSettlementModel {
  if (new Set(queryOrder).size !== queryOrder.length) {
    throw new Error(`A refetch call cannot contain duplicate Query identities`)
  }
  return {
    queryOrder: [...queryOrder],
    fetches: new Map(queryOrder.map((queryId) => [queryId, `pending`])),
    applications: new Map(),
    throwOnError,
  }
}

function reduceRefetchCallSettlement(
  model: RefetchCallSettlementModel,
  action: RefetchCallSettlementAction,
): RefetchCallSettlementModel {
  if (action.type === `accept-application`) {
    if (model.fetches.get(action.queryId) !== `pending`) {
      throw new Error(`Applications belong to an active Query fetch`)
    }
    if (model.applications.has(action.applicationId)) {
      throw new Error(`Application ${action.applicationId} already exists`)
    }
    return {
      ...model,
      applications: new Map(model.applications).set(action.applicationId, {
        queryId: action.queryId,
        outcome: `pending`,
      }),
    }
  }

  if (action.type === `settle-fetch`) {
    if (model.fetches.get(action.queryId) !== `pending`) {
      throw new Error(`Query fetch ${action.queryId} already settled`)
    }
    return {
      ...model,
      fetches: new Map(model.fetches).set(action.queryId, action.outcome),
    }
  }

  const application = model.applications.get(action.applicationId)
  if (!application) {
    throw new Error(`Unknown application ${action.applicationId}`)
  }
  if (application.outcome !== `pending`) {
    throw new Error(`Application ${action.applicationId} already settled`)
  }
  return {
    ...model,
    applications: new Map(model.applications).set(action.applicationId, {
      ...application,
      outcome: action.outcome,
    }),
  }
}

function observeRefetchCallSettlement(model: RefetchCallSettlementModel): {
  refetch: RefetchApplicationOutcome
  resultOrder?: Array<string>
} {
  const fetchOutcomes = [...model.fetches.values()]
  const applicationOutcomes = [...model.applications.values()].map(
    ({ outcome }) => outcome,
  )
  if (
    model.throwOnError &&
    [...fetchOutcomes, ...applicationOutcomes].includes(`rejected`)
  ) {
    return { refetch: `rejected` }
  }
  if (
    fetchOutcomes.includes(`pending`) ||
    applicationOutcomes.includes(`pending`)
  ) {
    return { refetch: `pending` }
  }
  return { refetch: `resolved`, resultOrder: model.queryOrder }
}

/**
 * A handler-scoped refetch has one Query fetch obligation. Its accepted
 * Collection application remains outside the handler boundary because that
 * application is queued behind the invoking mutation transaction. A later
 * application failure is recorded by Collection error utilities; it cannot
 * retroactively change the already-settled handler call.
 */
type HandlerRefetchBoundaryModel = {
  fetch: `pending` | `fulfilled` | `rejected`
  application: `unaccepted` | `pending` | `fulfilled` | `rejected`
  throwOnError: boolean
}

type HandlerRefetchBoundaryAction =
  | { type: `accept-application` }
  | { type: `settle-fetch`; outcome: `fulfilled` | `rejected` }
  | { type: `settle-application`; outcome: `fulfilled` | `rejected` }

function reduceHandlerRefetchBoundary(
  model: HandlerRefetchBoundaryModel,
  action: HandlerRefetchBoundaryAction,
): HandlerRefetchBoundaryModel {
  if (action.type === `accept-application`) {
    if (model.application !== `unaccepted`) {
      throw new Error(`Handler application already accepted`)
    }
    return { ...model, application: `pending` }
  }
  if (action.type === `settle-fetch`) {
    if (model.fetch !== `pending`) {
      throw new Error(`Handler Query fetch already settled`)
    }
    return { ...model, fetch: action.outcome }
  }
  if (model.application !== `pending`) {
    throw new Error(`Handler application is not pending`)
  }
  return { ...model, application: action.outcome }
}

function observeHandlerRefetchBoundary(model: HandlerRefetchBoundaryModel): {
  refetch: RefetchApplicationOutcome
  applicationErrorRecorded: boolean
} {
  return {
    refetch:
      model.fetch === `pending`
        ? `pending`
        : model.fetch === `rejected` && model.throwOnError
          ? `rejected`
          : `resolved`,
    applicationErrorRecorded: model.application === `rejected`,
  }
}

function createQueryClient(
  customHash = false,
  staleTime = Number.POSITIVE_INFINITY,
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime,
        queryKeyHashFn: customHash
          ? (key) => `custom:${hashKey(key)}`
          : undefined,
      },
    },
  })
}

function recordMetadata(
  metadata: SyncMetadataApi<string | number>,
  recorder: MetadataRecorder,
): SyncMetadataApi<string | number> {
  // These are emitted writes, captured before delegation, not durable commits.
  return {
    ...metadata,
    row: {
      get: (key) => metadata.row.get(key),
      set: (key, value) => {
        recorder.writes.push({ type: `set`, key })
        recorder.rows.set(key, value)
        metadata.row.set(key, value)
      },
      delete: (key) => {
        recorder.writes.push({ type: `delete`, key })
        recorder.rows.delete(key)
        metadata.row.delete(key)
      },
    },
    collection: {
      get: (key) => metadata.collection.get(key),
      set: (key, value) => metadata.collection.set(key, value),
      delete: (key) => metadata.collection.delete(key),
      list: (prefix) => metadata.collection.list(prefix),
    },
  }
}

function createOwnershipFixture({
  id,
  results,
  getKey = (item) => item.id,
  syncMode = `on-demand`,
  metadataRecorder,
  setupMetadata,
  scanPersistedRows,
  customHash,
  staleTime,
}: OwnershipFixtureOptions): OwnershipFixture {
  const queryClient = createQueryClient(customHash, staleTime)
  const queryFn = vi.fn<() => Promise<Array<Item>>>()
  results.forEach((result) =>
    queryFn.mockImplementationOnce(() => Promise.resolve(result)),
  )
  queryFn.mockRejectedValue(new Error(`Unexpected ownership refetch`))
  const baseOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn,
    getKey,
    syncMode,
    startSync: true,
  })
  const originalSync = baseOptions.sync
  let pendingSetup = setupMetadata
  const collection = createCollection(
    metadataRecorder || setupMetadata || scanPersistedRows
      ? {
          ...baseOptions,
          sync: {
            sync: (params: Parameters<typeof originalSync.sync>[0]) => {
              if (!params.metadata) {
                throw new Error(`Sync metadata API is unavailable`)
              }
              const observedMetadata = metadataRecorder
                ? recordMetadata(params.metadata, metadataRecorder)
                : params.metadata
              const metadataWithPersistedScan: SyncMetadataApi<
                string | number
              > = scanPersistedRows
                ? {
                    ...observedMetadata,
                    persistence: {
                      protocol: `@tanstack/db/sync-persistence`,
                      version: 1,
                      hydrateBaseline: async () => {},
                      scanPersistedRows,
                      resumeSnapshot: {
                        certify: async () => {},
                        getKeySetEvidence: () => ({ status: `consistent` }),
                        expectCurrentCommit: () => {},
                      },
                    },
                  }
                : observedMetadata
              if (pendingSetup) {
                params.begin()
                pendingSetup(metadataWithPersistedScan)
                params.commit()
                pendingSetup = undefined
              }
              return originalSync.sync({
                ...params,
                metadata: metadataWithPersistedScan,
              })
            },
          },
        }
      : baseOptions,
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
  })
  return { collection, queryClient, queryFn }
}

function rows(collection: {
  keys: () => Iterable<string | number>
}): Array<string> {
  return Array.from(collection.keys()).map(String).sort()
}

function itemIds(items: Iterable<Item>): Array<string> {
  return Array.from(items, ({ id }) => id).sort()
}

function expectMutationLifecycleSnapshot(
  snapshot: MutationLifecycleSnapshot,
  authoritative: ReadonlyArray<string>,
  visible: ReadonlyArray<string>,
  ordered: boolean,
): void {
  expect(snapshot).toEqual({
    server: [...authoritative].sort(),
    cache: [...authoritative].sort(),
    synced: [...authoritative].sort(),
    source: [...visible].sort(),
    derived: ordered ? [...visible] : [...visible].sort(),
  })
}

function expectMutationPublicationIntegrity(
  publications: ReadonlyArray<MutationPublicationSnapshot>,
): void {
  for (const publication of publications) {
    expect(publication).toEqual({
      source: publication.expected,
      derived: publication.expected,
      expected: publication.expected,
    })
  }
}

function persistedOwners(
  metadata: ReadonlyMap<string | number, unknown>,
  rowId: string,
): Array<string> {
  const rowMetadata = metadata.get(rowId)
  if (!rowMetadata || typeof rowMetadata !== `object`) return []
  const queryCollection = (rowMetadata as Record<string, unknown>)
    .queryCollection
  if (!queryCollection || typeof queryCollection !== `object`) return []
  const owners = (queryCollection as Record<string, unknown>).owners
  return owners && typeof owners === `object` ? Object.keys(owners).sort() : []
}

type StoredOwnership = {
  rows: Map<string | number, Item>
  rowMetadata: Map<string | number, unknown>
  collectionMetadata: Map<string, unknown>
}

function categorySubset(category: `detail` | `list`): LoadSubsetOptions {
  return {
    where: new IR.Func(`in`, [
      new IR.PropRef([`category`]),
      new IR.Value([`shared`, category]),
    ]),
  }
}

function selectOwnershipRows(
  items: Iterable<Item>,
  options: LoadSubsetOptions,
): Array<Item> {
  if (
    options.orderBy !== undefined ||
    options.limit !== undefined ||
    options.offset !== undefined ||
    options.cursor !== undefined
  ) {
    throw new Error(`Ownership fixture does not support ordering or windows`)
  }
  const { where } = options
  if (!where) return Array.from(items, (item) => structuredClone(item))
  if (
    where.type !== `func` ||
    where.name !== `in` ||
    where.args.length !== 2 ||
    where.args[0]?.type !== `ref` ||
    where.args[0].path.length !== 1 ||
    where.args[0].path[0] !== `category` ||
    where.args[1]?.type !== `val` ||
    !Array.isArray(where.args[1].value) ||
    !where.args[1].value.every((value: unknown) => typeof value === `string`)
  ) {
    throw new Error(`Ownership fixture supports only category membership`)
  }
  const categories = new Set<string>(where.args[1].value)
  return Array.from(items)
    .filter((item) => categories.has(item.category))
    .map((item) => structuredClone(item))
}

function createOwnershipStorage(seed?: StoredOwnership, gatedCommit?: number) {
  const state: StoredOwnership = structuredClone(
    seed ?? {
      rows: new Map(),
      rowMetadata: new Map(),
      collectionMetadata: new Map(),
    },
  )
  const entered = createDeferred<void>()
  const released = createDeferred<void>()
  let commitCount = 0
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  const adapter: PersistenceAdapter = {
    loadSubset: (_id, options) =>
      Promise.resolve(
        selectOwnershipRows(state.rows.values(), options).map((value) => ({
          key: value.id,
          value,
          metadata: structuredClone(state.rowMetadata.get(value.id)),
        })),
      ),
    loadResumeSnapshot: (_id, options) =>
      Promise.resolve({
        rows:
          options?.includeRows === false
            ? []
            : Array.from(state.rows, ([key, value]) => ({
                key,
                value: structuredClone(value),
                metadata: structuredClone(state.rowMetadata.get(key)),
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(
          state.collectionMetadata,
          ([key, value]) => ({ key, value: structuredClone(value) }),
        ),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch: 0,
      }),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(state.collectionMetadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    scanRows: () =>
      Promise.resolve(
        Array.from(state.rows, ([key, value]) => ({
          key,
          value: structuredClone(value),
          metadata: structuredClone(state.rowMetadata.get(key)),
        })),
      ),
    ensureIndex: () => Promise.resolve(),
    applyCommittedTx: async (_id, transaction) => {
      const tx = structuredClone(transaction)
      commitCount++
      if (commitCount === gatedCommit) {
        entered.resolve()
        await released.promise
      }
      if (tx.truncate) {
        state.rows.clear()
        state.rowMetadata.clear()
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          state.rows.delete(mutation.key)
          state.rowMetadata.delete(mutation.key)
        } else {
          const { id, category, name } = mutation.value
          if (
            typeof id !== `string` ||
            typeof category !== `string` ||
            typeof name !== `string`
          ) {
            throw new Error(`Ownership fixture received an invalid row`)
          }
          state.rows.set(mutation.key, { id, category, name })
          if (mutation.metadataChanged) {
            state.rowMetadata.set(
              mutation.key,
              structuredClone(mutation.metadata),
            )
          }
        }
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        if (mutation.type === `delete`) state.rowMetadata.delete(mutation.key)
        else
          state.rowMetadata.set(mutation.key, structuredClone(mutation.value))
      }
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`)
          state.collectionMetadata.delete(mutation.key)
        else
          state.collectionMetadata.set(
            mutation.key,
            structuredClone(mutation.value),
          )
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
    },
  }
  return {
    adapter,
    entered: entered.promise,
    release: () => released.resolve(),
    snapshot: (): StoredOwnership => structuredClone(state),
  }
}

function createPersistedOwnershipFixture(
  id: string,
  storage: ReturnType<typeof createOwnershipStorage>,
  serverRows: Array<Item>,
) {
  const queryClient = createQueryClient()
  const providerRows = structuredClone(serverRows)
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      selectOwnershipRows(providerRows, context.meta?.loadSubsetOptions ?? {}),
    ),
  )
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        persistedGcTime: Number.POSITIVE_INFINITY,
        startSync: true,
      }),
      persistence: { adapter: storage.adapter },
    }),
  )
  cleanups.push(async () => {
    storage.release()
    try {
      await collection.cleanup()
    } finally {
      queryClient.clear()
    }
  })
  return { collection, queryClient, queryFn }
}

function storedItems(
  storage: ReturnType<typeof createOwnershipStorage>,
): Array<Item> {
  return [...storage.snapshot().rows.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )
}

type ColdOwnershipObservation = { stored: Array<Item>; visible: Array<Item> }

async function observeColdOwnerRevalidation(
  dropMetadata = false,
): Promise<Array<ColdOwnershipObservation>> {
  const hotStorage = createOwnershipStorage(undefined, 1)
  const hot = createPersistedOwnershipFixture(
    `cold-owner-revalidation`,
    hotStorage,
    [shared, detailOnly, listOnly],
  )
  const detail = categorySubset(`detail`)
  const list = categorySubset(`list`)
  const firstLoad = Promise.resolve(hot.collection._sync.loadSubset(detail))
  // Observe rejection before any gate assertion can abort the test.
  void firstLoad.catch(() => undefined)
  try {
    await hotStorage.entered
    expect(hotStorage.snapshot().rows.size).toBe(0)
    expect(hotStorage.snapshot().rowMetadata.size).toBe(0)
    hotStorage.release()
    await firstLoad
    await hot.collection._sync.loadSubset(list)
    await vi.waitFor(() =>
      expect(storedItems(hotStorage)).toEqual([detailOnly, listOnly, shared]),
    )
    hot.collection._sync.unloadSubset(detail)
    hot.collection._sync.unloadSubset(list)
    // Both retention markers must commit before making a separate cold store.
    // Their private hash encoding is not the expected ownership authority.
    await vi.waitFor(() =>
      expect(hotStorage.snapshot().collectionMetadata.size).toBe(2),
    )
    const coldSeed = hotStorage.snapshot()
    if (dropMetadata) coldSeed.rowMetadata.clear()
    const coldStorage = createOwnershipStorage(coldSeed)
    const cold = createPersistedOwnershipFixture(
      `cold-owner-revalidation`,
      coldStorage,
      [],
    )
    expect(cold.queryFn).not.toHaveBeenCalled()
    const capture = (): ColdOwnershipObservation => ({
      stored: storedItems(coldStorage),
      visible: cold.collection.toArray
        .map(({ id, category, name }) => ({ id, category, name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
    const observations = [capture()]
    await cold.collection._sync.loadSubset(detail)
    await vi.waitFor(() =>
      expect(coldStorage.snapshot().collectionMetadata.size).toBe(1),
    )
    observations.push(capture())
    await cold.collection._sync.loadSubset(list)
    await vi.waitFor(() =>
      expect(coldStorage.snapshot().collectionMetadata.size).toBe(0),
    )
    observations.push(capture())
    expect(cold.queryFn).toHaveBeenCalledTimes(2)
    return observations
  } finally {
    hotStorage.release()
  }
}

function expectColdOwnerRevalidation(
  observations: Array<ColdOwnershipObservation>,
): void {
  expect(observations).toEqual([
    { stored: [detailOnly, listOnly, shared], visible: [] },
    { stored: [listOnly, shared], visible: [shared] },
    { stored: [], visible: [] },
  ])
}

describe(`query collection ownership lifecycle`, () => {
  afterEach(async () => {
    await runCleanups()
  })

  it(`keeps an accepted empty-diff result pending until application`, () => {
    const initial: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([[`query`, `same`]]),
    }
    const started = reduceExplicitRefetchApplication(initial, {
      type: `start-call`,
      callId: 1,
      resultIds: [`query`],
      throwOnError: true,
    })
    const accepted = reduceExplicitRefetchApplication(started, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: `same`,
    })

    expectExplicitRefetchObservation(
      observeExplicitRefetchApplication(accepted, 1),
      {
        publicValues: { query: `same` },
        refetch: `pending`,
      },
    )
    const fulfilled = reduceExplicitRefetchApplication(accepted, {
      type: `fulfill-application`,
      callId: 1,
      resultId: `query`,
    })
    expectExplicitRefetchObservation(
      observeExplicitRefetchApplication(fulfilled, 1),
      {
        publicValues: { query: `same` },
        refetch: `resolved`,
        resultOrder: [`query`],
      },
    )
  })

  it(`retains separate outcomes for a retired caller and its successor`, () => {
    let model: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([[`query`, `initial`]]),
    }
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 1,
      resultIds: [`query`],
      throwOnError: true,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: `first`,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 2,
      resultIds: [`query`],
      throwOnError: true,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 2,
      resultId: `query`,
      value: `second`,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `retire-application`,
      callId: 1,
      resultId: `query`,
    })

    expectExplicitRefetchObservation(
      observeExplicitRefetchApplication(model, 1),
      {
        publicValues: { query: `initial` },
        refetch: `rejected`,
      },
    )
    expectExplicitRefetchObservation(
      observeExplicitRefetchApplication(model, 2),
      {
        publicValues: { query: `initial` },
        refetch: `pending`,
      },
    )

    model = reduceExplicitRefetchApplication(model, {
      type: `fulfill-application`,
      callId: 2,
      resultId: `query`,
    })
    expectExplicitRefetchObservation(
      observeExplicitRefetchApplication(model, 2),
      {
        publicValues: { query: `second` },
        refetch: `resolved`,
        resultOrder: [`query`],
      },
    )
  })

  it(`rejects a fetch-boundary-only wrong-result control`, () => {
    let model: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([[`query`, `Optimistic`]]),
    }
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 1,
      resultIds: [`query`],
      throwOnError: true,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: `Authoritative`,
    })
    const expected = observeExplicitRefetchApplication(model, 1)
    const fetchBoundaryOnly: ExplicitRefetchObservation = {
      publicValues: { query: `Optimistic` },
      refetch: `pending`,
      resultOrder: [`query`],
    }
    fetchBoundaryOnly.refetch = `resolved`

    expect(() =>
      expectExplicitRefetchObservation(fetchBoundaryOnly, expected),
    ).toThrow()
    expect(() =>
      expectExplicitRefetchObservation(expected, expected),
    ).not.toThrow()
  })

  it(`rejects illegal explicit-refetch model histories`, () => {
    const started = reduceExplicitRefetchApplication(
      { calls: new Map(), publicValues: new Map() },
      {
        type: `start-call`,
        callId: 1,
        resultIds: [`query`],
        throwOnError: true,
      },
    )
    const accepted = reduceExplicitRefetchApplication(started, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: `accepted`,
    })

    expect(() =>
      reduceExplicitRefetchApplication(started, {
        type: `start-call`,
        callId: 1,
        resultIds: [`replacement`],
        throwOnError: true,
      }),
    ).toThrow(`already exists`)
    expect(() =>
      reduceExplicitRefetchApplication(accepted, {
        type: `accept-result`,
        callId: 1,
        resultId: `query`,
        value: `replacement`,
      }),
    ).toThrow(`already accepted`)
    expect(() =>
      reduceExplicitRefetchApplication(accepted, {
        type: `fulfill-application`,
        callId: 1,
        resultId: `unknown`,
      }),
    ).toThrow(`Unknown result`)
    const fulfilled = reduceExplicitRefetchApplication(accepted, {
      type: `fulfill-application`,
      callId: 1,
      resultId: `query`,
    })
    expect(() =>
      reduceExplicitRefetchApplication(fulfilled, {
        type: `fulfill-application`,
        callId: 1,
        resultId: `query`,
      }),
    ).toThrow(`already settled`)
  })

  it(`keeps a suppressed fetch failure pending for its accepted application`, () => {
    let model = createRefetchCallSettlementModel([`query`], false)
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `cached-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `query`,
      outcome: `rejected`,
    })
    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `pending`,
    })

    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `cached-result`,
      outcome: `fulfilled`,
    })
    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `resolved`,
      resultOrder: [`query`],
    })
  })

  it(`rejects fail-fast while an independent application remains pending`, () => {
    let model = createRefetchCallSettlementModel([`detail`, `list`], true)
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `detail`,
      applicationId: `detail-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `list`,
      applicationId: `list-result`,
    })
    for (const queryId of [`detail`, `list`]) {
      model = reduceRefetchCallSettlement(model, {
        type: `settle-fetch`,
        queryId,
        outcome: `fulfilled`,
      })
    }
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `detail-result`,
      outcome: `rejected`,
    })

    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `rejected`,
    })
    expect(model.applications.get(`list-result`)?.outcome).toBe(`pending`)
  })

  it(`rejects a handler call that resolves before its Query fetch`, () => {
    const model: HandlerRefetchBoundaryModel = {
      fetch: `pending`,
      application: `unaccepted`,
      throwOnError: true,
    }
    const expected = observeHandlerRefetchBoundary(model)
    const returnsAfterInvocation = {
      ...expected,
      refetch: `resolved` as const,
    }

    expect(() => expect(returnsAfterInvocation).toEqual(expected)).toThrow()
    expect(expected).toEqual({
      refetch: `pending`,
      applicationErrorRecorded: false,
    })
  })

  it(`resolves a refetch with no tracked Query results`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `explicit-refetch-empty-aggregate`,
      results: [],
      syncMode: `on-demand`,
    })
    const model = reduceExplicitRefetchApplication(
      { calls: new Map(), publicValues: new Map() },
      {
        type: `start-call`,
        callId: 1,
        resultIds: [],
        throwOnError: true,
      },
    )

    const results = await collection.utils.refetch({ throwOnError: true })

    expect(queryFn).not.toHaveBeenCalled()
    expectExplicitRefetchObservation(
      { publicValues: {}, refetch: `resolved`, resultOrder: [] },
      observeExplicitRefetchApplication(model, 1),
    )
    expect(results).toEqual([])
  })

  it(`waits for an accepted fetching result after a suppressed fetch failure`, async () => {
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
      await transaction.isPersisted.promise.catch(() => undefined)
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

    let model = createRefetchCallSettlementModel([`query`], false)
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
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.utils.isFetching).toBe(false)
    })
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `cached-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `query`,
      outcome: `rejected`,
    })
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(actualOutcome).toBe(observeRefetchCallSettlement(model).refetch)
    expect(collection.get(shared.id)?.name).toBe(`Optimistic`)

    persistence.resolve()
    await transaction.isPersisted.promise
    const results = await refetch
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `cached-result`,
      outcome: `fulfilled`,
    })
    expect(actualOutcome).toBe(observeRefetchCallSettlement(model).refetch)
    expect(results).toHaveLength(1)
    expect(results[0]?.isError).toBe(true)
  })

  it(`waits for every Query result and preserves tracked-key order`, async () => {
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
    const detail = { where: eq(`category`, `detail`) }
    const list = { where: eq(`category`, `list`) }
    await collection._sync.loadSubset(detail)
    await collection._sync.loadSubset(list)

    let model: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([
        [`detail`, detailOnly.name],
        [`list`, listOnly.name],
      ]),
    }
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 1,
      resultIds: [`detail`, `list`],
      throwOnError: true,
    })
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
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(4))

    secondRefresh.resolve([refreshedList])
    await vi.waitFor(() =>
      expect(collection.get(listOnly.id)?.name).toBe(refreshedList.name),
    )
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `list`,
      value: refreshedList.name,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `fulfill-application`,
      callId: 1,
      resultId: `list`,
    })
    expectExplicitRefetchObservation(
      {
        publicValues: {
          detail: collection.get(detailOnly.id)?.name,
          list: collection.get(listOnly.id)?.name,
        },
        refetch: refetchOutcome,
      },
      observeExplicitRefetchApplication(model, 1),
    )

    firstRefresh.resolve([refreshedDetail])
    const results = await refetch
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `detail`,
      value: refreshedDetail.name,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `fulfill-application`,
      callId: 1,
      resultId: `detail`,
    })
    expectExplicitRefetchObservation(
      {
        publicValues: {
          detail: collection.get(detailOnly.id)?.name,
          list: collection.get(listOnly.id)?.name,
        },
        refetch: refetchOutcome,
        resultOrder: results.map((result) => {
          if (!result || !Array.isArray(result.data) || !result.data[0]) {
            throw new Error(`Expected one applied row per Query result`)
          }
          return (result.data[0] as Item).category
        }),
      },
      observeExplicitRefetchApplication(model, 1),
    )
  })

  it(`rejects before an independent accepted application settles`, async () => {
    const id = `explicit-refetch-fail-fast`
    const detail = { where: eq(`category`, `detail`) }
    const list = { where: eq(`category`, `list`) }
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
    await vi.waitFor(() => expect(scanPersistedRows).toHaveBeenCalledOnce())

    let model = createRefetchCallSettlementModel([`detail`, `list`], true)
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `detail`,
      applicationId: `detail-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `list`,
      applicationId: `list-result`,
    })
    for (const queryId of [`detail`, `list`]) {
      model = reduceRefetchCallSettlement(model, {
        type: `settle-fetch`,
        queryId,
        outcome: `fulfilled`,
      })
    }
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `detail-result`,
      outcome: `rejected`,
    })

    const refetch = collection.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    await vi.waitFor(() => expect(scanPersistedRows).toHaveBeenCalledTimes(2))
    await expect(refetch).rejects.toBe(applicationError)
    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `rejected`,
    })
    expect(model.applications.get(`list-result`)?.outcome).toBe(`pending`)

    pendingListScan.resolve([])
    await initialListLoad.catch(() => undefined)
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `list-result`,
      outcome: `fulfilled`,
    })
    await vi.waitFor(() => {
      expect(collection.get(listOnly.id)?.name).toBe(refreshedList.name)
    })
    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `rejected`,
    })
  })

  it.each([
    {
      caseName: `changed`,
      id: `explicit-refetch-changed-application`,
      initialName: `Initial`,
      authoritativeName: `Authoritative`,
    },
    {
      caseName: `empty-diff`,
      id: `explicit-refetch-empty-diff-application`,
      initialName: `Same`,
      authoritativeName: `Same`,
    },
  ])(
    `settles a $caseName accepted result after application`,
    async ({ id, initialName, authoritativeName }) => {
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
        await transaction.isPersisted.promise
      })

      let model: ExplicitRefetchApplicationModel = {
        calls: new Map(),
        publicValues: new Map([[`query`, `Optimistic`]]),
      }
      model = reduceExplicitRefetchApplication(model, {
        type: `start-call`,
        callId: 1,
        resultIds: [`query`],
        throwOnError: true,
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

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(
          queryClient.getQueryCache().find({ queryKey: [id], exact: true })
            ?.state.dataUpdateCount,
        ).toBe(2)
        expect(collection.utils.isFetching).toBe(false)
      })
      model = reduceExplicitRefetchApplication(model, {
        type: `accept-result`,
        callId: 1,
        resultId: `query`,
        value: authoritative.name,
      })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()

      expectExplicitRefetchObservation(
        {
          publicValues: { query: collection.get(shared.id)?.name },
          refetch: refetchOutcome,
        },
        observeExplicitRefetchApplication(model, 1),
      )

      persistence.resolve()
      await transaction.isPersisted.promise
      await refetch
      model = reduceExplicitRefetchApplication(model, {
        type: `fulfill-application`,
        callId: 1,
        resultId: `query`,
      })
      expectExplicitRefetchObservation(
        {
          publicValues: { query: collection.get(shared.id)?.name },
          refetch: refetchOutcome,
          resultOrder: [`query`],
        },
        observeExplicitRefetchApplication(model, 1),
      )
    },
  )

  it(`keeps an external refetch at the application boundary during a mutation handler`, async () => {
    const initial = { ...shared, name: `Initial` }
    const authoritative = { ...shared, name: `Authoritative` }
    const handlerStarted = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([authoritative])
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id: `external-refetch-overlaps-handler`,
        queryClient,
        queryKey: [`external-refetch-overlaps-handler`],
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onUpdate: async () => {
          handlerStarted.resolve()
          await releaseHandler.promise
          return { refetch: false }
        },
      }),
    )
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })
    await collection.stateWhenReady()

    const mutation = collection.update(shared.id, (draft) => {
      draft.name = `Optimistic`
    })
    await handlerStarted.promise
    let model: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([[`query`, `Optimistic`]]),
    }
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 1,
      resultIds: [`query`],
      throwOnError: true,
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
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.utils.isFetching).toBe(false)
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: authoritative.name,
    })
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()

    expectExplicitRefetchObservation(
      {
        publicValues: { query: collection.get(shared.id)?.name },
        refetch: refetchOutcome,
      },
      observeExplicitRefetchApplication(model, 1),
    )

    releaseHandler.resolve()
    await mutation.isPersisted.promise
    await refetch
    model = reduceExplicitRefetchApplication(model, {
      type: `fulfill-application`,
      callId: 1,
      resultId: `query`,
    })
    expectExplicitRefetchObservation(
      {
        publicValues: { query: collection.get(shared.id)?.name },
        refetch: refetchOutcome,
        resultOrder: [`query`],
      },
      observeExplicitRefetchApplication(model, 1),
    )
  })

  it.each([`parameter`, `mutation-alias`] as const)(
    `keeps the Query fetch boundary through the handler %s collection`,
    async (accessPath) => {
      const initial = { ...shared, name: `Initial` }
      const inserted = { id: `inserted`, category: `shared`, name: `Client` }
      const authoritative = { ...inserted, name: `Server` }
      const refresh = createDeferred<Array<Item>>()
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([initial])
        .mockReturnValueOnce(refresh.promise)
      let aliasesMatch = false
      let handlerOutcome: RefetchApplicationOutcome = `pending`
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id: `handler-refetch-boundary-${accessPath}`,
          queryClient,
          queryKey: [`handler-refetch-boundary`, accessPath],
          queryFn,
          getKey: (item) => item.id,
          startSync: true,
          onInsert: async ({ transaction, collection: handlerCollection }) => {
            const mutationCollection = transaction.mutations[0].collection
            aliasesMatch = mutationCollection === handlerCollection
            const refetchCollection =
              accessPath === `parameter`
                ? handlerCollection
                : mutationCollection
            await refetchCollection.utils.refetch({ throwOnError: true }).then(
              () => {
                handlerOutcome = `resolved`
              },
              (error: unknown) => {
                handlerOutcome = `rejected`
                throw error
              },
            )
            return { refetch: false }
          },
        }),
      )
      cleanups.push(async () => {
        refresh.resolve([initial, authoritative])
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()

      let model: HandlerRefetchBoundaryModel = {
        fetch: `pending`,
        application: `unaccepted`,
        throwOnError: true,
      }
      const mutation = collection.insert(inserted)
      void mutation.isPersisted.promise.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      expect(handlerOutcome).toBe(observeHandlerRefetchBoundary(model).refetch)

      refresh.resolve([initial, authoritative])
      model = reduceHandlerRefetchBoundary(model, {
        type: `accept-application`,
      })
      model = reduceHandlerRefetchBoundary(model, {
        type: `settle-fetch`,
        outcome: `fulfilled`,
      })
      await vi.waitFor(() => {
        expect(handlerOutcome).toBe(
          observeHandlerRefetchBoundary(model).refetch,
        )
      })
      expect(aliasesMatch).toBe(true)

      await mutation.isPersisted.promise
      model = reduceHandlerRefetchBoundary(model, {
        type: `settle-application`,
        outcome: `fulfilled`,
      })
      expect(observeHandlerRefetchBoundary(model)).toEqual({
        refetch: `resolved`,
        applicationErrorRecorded: false,
      })
      expect(collection.get(inserted.id)?.name).toBe(authoritative.name)
    },
  )

  it.each([
    { throwOnError: true, expectedOutcome: `rejected` as const },
    { throwOnError: false, expectedOutcome: `resolved` as const },
  ])(
    `settles an application failure with throwOnError=$throwOnError`,
    async ({ throwOnError, expectedOutcome }) => {
      const initial = { ...shared, name: `Initial` }
      const invalid = { ...shared, name: `Invalid` }
      const applicationError = new Error(`Explicit refetch application failed`)
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([initial])
        .mockResolvedValueOnce([invalid])
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id: `explicit-refetch-application-failure-${throwOnError}`,
          queryClient,
          queryKey: [`explicit-refetch-application-failure`, throwOnError],
          queryFn,
          getKey: (item) => {
            if (item.name === invalid.name) throw applicationError
            return item.id
          },
          startSync: true,
        }),
      )
      cleanups.push(async () => {
        consoleError.mockRestore()
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()

      let model: ExplicitRefetchApplicationModel = {
        calls: new Map(),
        publicValues: new Map([[`query`, initial.name]]),
      }
      model = reduceExplicitRefetchApplication(model, {
        type: `start-call`,
        callId: 1,
        resultIds: [`query`],
        throwOnError,
      })
      model = reduceExplicitRefetchApplication(model, {
        type: `accept-result`,
        callId: 1,
        resultId: `query`,
        value: invalid.name,
      })
      model = reduceExplicitRefetchApplication(model, {
        type: `reject-application`,
        callId: 1,
        resultId: `query`,
      })

      let actualOutcome: RefetchApplicationOutcome
      const refetch = collection.utils.refetch({ throwOnError })
      if (throwOnError) {
        await expect(refetch).rejects.toBe(applicationError)
        actualOutcome = `rejected`
      } else {
        await expect(refetch).resolves.toHaveLength(1)
        actualOutcome = `resolved`
      }
      expect(actualOutcome).toBe(expectedOutcome)
      expectExplicitRefetchObservation(
        {
          publicValues: { query: collection.get(shared.id)?.name },
          refetch: actualOutcome,
          ...(actualOutcome === `resolved`
            ? { resultOrder: [`query`] }
            : undefined),
        },
        observeExplicitRefetchApplication(model, 1),
      )
    },
  )

  it(`records a handler-scoped application failure after fetch settlement`, async () => {
    const initial = { ...shared, name: `Initial` }
    const invalid = { ...shared, name: `Invalid` }
    const applicationError = new Error(`Handler application failed`)
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([invalid])
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    let handlerOutcome: RefetchApplicationOutcome = `pending`
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id: `handler-refetch-application-failure`,
        queryClient,
        queryKey: [`handler-refetch-application-failure`],
        queryFn,
        getKey: (item) => {
          if (item.name === invalid.name) throw applicationError
          return item.id
        },
        startSync: true,
        onUpdate: async ({ collection: handlerCollection }) => {
          await handlerCollection.utils.refetch({ throwOnError: true }).then(
            () => {
              handlerOutcome = `resolved`
            },
            (error: unknown) => {
              handlerOutcome = `rejected`
              throw error
            },
          )
          return { refetch: false }
        },
      }),
    )
    cleanups.push(async () => {
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })
    await collection.stateWhenReady()

    let model: HandlerRefetchBoundaryModel = {
      fetch: `pending`,
      application: `unaccepted`,
      throwOnError: true,
    }
    const mutation = collection.update(shared.id, (draft) => {
      draft.name = `Optimistic`
    })
    await mutation.isPersisted.promise
    model = reduceHandlerRefetchBoundary(model, {
      type: `accept-application`,
    })
    model = reduceHandlerRefetchBoundary(model, {
      type: `settle-fetch`,
      outcome: `fulfilled`,
    })
    model = reduceHandlerRefetchBoundary(model, {
      type: `settle-application`,
      outcome: `rejected`,
    })
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(applicationError)
    })

    expect({
      refetch: handlerOutcome,
      applicationErrorRecorded: collection.utils.lastError === applicationError,
    }).toEqual(observeHandlerRefetchBoundary(model))
  })

  it(`starts an idle collection only when a direct write is invoked`, () => {
    const queryClient = createQueryClient()
    const queryFn = vi.fn((): Promise<Array<Item>> => Promise.resolve([]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id: `idle-direct-write-startup`,
        queryClient,
        queryKey: [`idle-direct-write-startup`],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    expect(collection.status).toBe(`idle`)
    expect(collection.utils.isError).toBe(false)
    expect(collection.status).toBe(`idle`)

    collection.utils.writeUpsert({
      id: `first`,
      category: `direct`,
      name: `First`,
    })

    expect(collection.status).toBe(`ready`)
    expect(rows(collection)).toEqual([`first`])
    expect(queryFn).not.toHaveBeenCalled()
  })

  it(`fails fast when a direct write is attempted during deferred startup`, () => {
    const queryClient = createQueryClient()
    const queryFn = vi.fn((): Promise<Array<Item>> => Promise.resolve([]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id: `deferred-direct-write`,
        queryClient,
        queryKey: [`deferred-direct-write`],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    expect(collection._deferSyncStart()).toBe(true)
    for (const write of [
      () => collection.utils.writeInsert(shared),
      () => collection.utils.writeUpdate(shared),
      () => collection.utils.writeDelete(shared.id),
      () => collection.utils.writeUpsert(shared),
      () => collection.utils.writeBatch(() => {}),
    ]) {
      expect(write).toThrow(SyncNotInitializedError)
    }
    expect(collection.status).toBe(`idle`)
    expect(rows(collection)).toEqual([])

    collection._resumeSyncStart()
    expect(collection.status).toBe(`ready`)
    expect(rows(collection)).toEqual([])
    expect(queryFn).not.toHaveBeenCalled()
  })

  it(`does not restart a cleaned-up idle collection for a direct write`, async () => {
    const id = `cleaned-idle-direct-write`
    const queryClient = createQueryClient()
    const queryFn = vi.fn((): Promise<Array<Item>> => Promise.resolve([]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.cleanup()
    expect(() => collection.utils.writeUpsert(shared)).toThrow(
      SyncNotInitializedError,
    )
    expect(collection.status).toBe(`cleaned-up`)
    expect(rows(collection)).toEqual([])
    expect(queryFn).not.toHaveBeenCalled()
  })

  it(`does not restart a cleaned-up collection for a late mutation refetch`, async () => {
    const id = `late-mutation-after-cleanup`
    const queryKey = [id] as const
    const inserted = { id: `late`, category: `mutation`, name: `Late` }
    const serverRows: Array<Item> = []
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(serverRows)))
    let writeLate = (_item: Item) => {}
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onInsert: async ({ transaction }) => {
          handlerEntered.resolve()
          await releaseHandler.promise
          transaction.mutations.forEach(({ modified }) =>
            writeLate(structuredClone(modified)),
          )
          return { refetch: false }
        },
      }),
    )
    writeLate = (item) => collection.utils.writeUpsert(item)
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    expect(queryFn).toHaveBeenCalledOnce()

    const mutation = collection.insert(inserted)
    await handlerEntered.promise
    await collection.cleanup()
    releaseHandler.resolve()
    await mutation.isPersisted.promise

    expect(collection.status).toBe(`cleaned-up`)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(itemIds(collection._state.syncedData.values())).toEqual([])
    expect(queryClient.getQueryData(queryKey)).toEqual([])
  })

  it.each([
    { ordered: false, settlementOrder: [0, 1] },
    { ordered: false, settlementOrder: [1, 0] },
    { ordered: true, settlementOrder: [0, 1] },
    { ordered: true, settlementOrder: [1, 0] },
  ] as const)(
    `publishes mutation refetches through source and downstream view: %j`,
    async ({ ordered, settlementOrder }) => {
      const id = `mutation-publication-${ordered ? `ordered` : `unordered`}-${settlementOrder.join(``)}`
      const queryClient = createQueryClient()
      const serverRows: Array<Item> = []
      const persistenceGates: Array<ReturnType<typeof createDeferred<void>>> =
        []
      const queryFn = vi.fn(() =>
        Promise.resolve(serverRows.map((item) => structuredClone(item))),
      )
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          startSync: true,
          onInsert: async ({ transaction }) => {
            const gate = createDeferred<void>()
            persistenceGates.push(gate)
            await gate.promise
            serverRows.push(
              ...transaction.mutations.map(({ modified }) =>
                structuredClone(modified),
              ),
            )
          },
        }),
      )
      const derived = createLiveQueryCollection((query) => {
        const source = query.from({ item: collection })
        const result = ordered
          ? source.orderBy(({ item }) => item.name, `asc`)
          : source
        return result.select(({ item }) => ({ ...item }))
      })
      const publications: Array<MutationPublicationSnapshot> = []
      let expectedPublication: Array<string> = []
      const subscription = derived.subscribeChanges(() => {
        publications.push({
          source: ordered
            ? [...collection.toArray]
                .sort((left, right) => left.name.localeCompare(right.name))
                .map(({ id: rowId }) => rowId)
            : rows(collection),
          derived: ordered
            ? derived.toArray.map(({ id: rowId }) => rowId)
            : rows(derived),
          expected: expectedPublication,
        })
      })
      cleanups.push(async () => {
        persistenceGates.forEach((gate) => gate.resolve())
        subscription.unsubscribe()
        await derived.cleanup()
        await collection.cleanup()
        queryClient.clear()
      })

      const firstItem = {
        id: `z-first`,
        category: `mutation`,
        name: `1-first`,
      }
      const secondItem = {
        id: `a-second`,
        category: `mutation`,
        name: `2-second`,
      }
      await derived.preload()
      expectedPublication = [firstItem.id]
      const first = collection.insert(firstItem)
      const visibleIds = [firstItem.id, secondItem.id]
      expectedPublication = ordered ? visibleIds : [...visibleIds].sort()
      const second = collection.insert(secondItem)
      const transactions = [first, second]
      const items = [firstItem, secondItem]
      const queryKey = [id] as const
      const capture = (): MutationLifecycleSnapshot => ({
        server: itemIds(serverRows),
        cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
        derived: ordered
          ? derived.toArray.map(({ id: rowId }) => rowId)
          : itemIds(derived.toArray),
      })

      expect(persistenceGates).toHaveLength(2)
      expect(queryFn).toHaveBeenCalledOnce()
      expectMutationLifecycleSnapshot(capture(), [], visibleIds, ordered)

      const settled = new Set<number>()
      for (const transactionIndex of settlementOrder) {
        persistenceGates[transactionIndex]!.resolve()
        await transactions[transactionIndex]!.isPersisted.promise
        settled.add(transactionIndex)

        const authoritativeIds = [...settled].map((index) => items[index]!.id)
        expect(queryFn).toHaveBeenCalledTimes(1 + settled.size)
        const expectedSynced =
          settled.size === transactions.length ? authoritativeIds : []
        expect(capture()).toEqual({
          server: [...authoritativeIds].sort(),
          cache: [...authoritativeIds].sort(),
          synced: [...expectedSynced].sort(),
          source: [...visibleIds].sort(),
          derived: ordered ? visibleIds : [...visibleIds].sort(),
        })
        expectMutationPublicationIntegrity(publications)
        expect(publications.at(-1)?.derived).toEqual(
          ordered ? visibleIds : [...visibleIds].sort(),
        )
      }

      const thirdItem = {
        id: `m-third`,
        category: `mutation`,
        name: `3-third`,
      }
      const allVisibleIds = [...visibleIds, thirdItem.id]
      expectedPublication = ordered ? allVisibleIds : [...allVisibleIds].sort()
      const third = collection.insert(thirdItem)
      expect(persistenceGates).toHaveLength(3)
      expectMutationLifecycleSnapshot(
        capture(),
        visibleIds,
        allVisibleIds,
        ordered,
      )

      persistenceGates[2]!.resolve()
      await third.isPersisted.promise

      expect(queryFn).toHaveBeenCalledTimes(4)
      expectMutationLifecycleSnapshot(
        capture(),
        allVisibleIds,
        allVisibleIds,
        ordered,
      )
      expectMutationPublicationIntegrity(publications)
      expect(publications.at(-1)?.derived).toEqual(
        ordered ? allVisibleIds : [...allVisibleIds].sort(),
      )
    },
  )

  it(`rejects incomplete and misordered mutation publication receipts`, () => {
    const visible = [`z-first`, `a-second`, `m-third`]
    const valid: MutationLifecycleSnapshot = {
      server: [...visible].sort(),
      cache: [...visible].sort(),
      synced: [...visible].sort(),
      source: [...visible].sort(),
      derived: visible,
    }

    expectMutationLifecycleSnapshot(valid, visible, visible, true)
    for (const mutant of [
      { ...valid, synced: [] },
      { ...valid, source: [] },
      { ...valid, derived: visible.slice(0, 2) },
      { ...valid, derived: [...visible].reverse() },
      { ...valid, source: [...valid.source, `stale`] },
    ]) {
      expect(() =>
        expectMutationLifecycleSnapshot(mutant, visible, visible, true),
      ).toThrow()
    }
  })

  it(`rejects a torn intermediate publication before a complete final snapshot`, () => {
    const first = [`z-first`]
    const firstAndSecond = [`z-first`, `a-second`]
    const allVisible = [`z-first`, `a-second`, `m-third`]
    const legitimateSequence: Array<MutationPublicationSnapshot> = [
      { source: first, derived: first, expected: first },
      {
        source: firstAndSecond,
        derived: firstAndSecond,
        expected: firstAndSecond,
      },
      { source: allVisible, derived: allVisible, expected: allVisible },
    ]

    expect(() =>
      expectMutationPublicationIntegrity(legitimateSequence),
    ).not.toThrow()
    expect(() =>
      expectMutationPublicationIntegrity([
        ...legitimateSequence.slice(0, 2),
        { source: [], derived: [], expected: allVisible },
        legitimateSequence[2]!,
      ]),
    ).toThrow()
  })

  it(`supersedes a stale focus result before publishing a newer mutation snapshot`, async () => {
    const id = `focus-result-supersession`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `mutation`, name: `A` }
    const retired = { id: `b`, category: `mutation`, name: `B` }
    const inserted = { id: `c`, category: `mutation`, name: `C` }
    const serverRows = [initial, retired]
    const firstFocus = createDeferred<Array<Item>>()
    const secondFocus = createDeferred<Array<Item>>()
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient(false, 0)
    let queryCalls = 0
    const queryFn = vi.fn(() => {
      queryCalls++
      if (queryCalls === 2) return firstFocus.promise
      if (queryCalls === 3) return secondFocus.promise
      return Promise.resolve(structuredClone(serverRows))
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
        staleTime: 0,
        refetchOnWindowFocus: true,
        onInsert: async ({ transaction }) => {
          serverRows.splice(
            0,
            serverRows.length,
            initial,
            ...transaction.mutations.map(({ modified }) =>
              structuredClone(modified),
            ),
          )
          handlerEntered.resolve()
          await releaseHandler.promise
          return { refetch: false }
        },
      }),
    )
    const derived = createLiveQueryCollection((query) =>
      query.from({ item: collection }).select(({ item }) => ({
        id: item.id,
        category: item.category,
        name: item.name,
      })),
    )
    const sourcePublications: Array<Array<string>> = []
    const derivedPublications: Array<MutationPublicationSnapshot> = []
    const sourceSubscription = collection.subscribeChanges(() => {
      sourcePublications.push(itemIds(collection.toArray))
    })
    const derivedSubscription = derived.subscribeChanges(() => {
      const source = itemIds(collection.toArray)
      derivedPublications.push({
        source,
        derived: itemIds(derived.toArray),
        expected: source,
      })
    })
    cleanups.push(async () => {
      releaseHandler.resolve()
      sourceSubscription.unsubscribe()
      derivedSubscription.unsubscribe()
      await derived.cleanup()
      await collection.cleanup()
      queryClient.clear()
      focusManager.setFocused(undefined)
    })

    await derived.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    sourcePublications.length = 0
    derivedPublications.length = 0

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    const mutation = collection.insert(inserted)
    await handlerEntered.promise
    firstFocus.resolve([structuredClone(initial)])
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(`idle`),
    )

    let waiterOutcome: `pending` | `resolved` | `rejected` = `pending`
    const waiter = Promise.resolve(collection._sync.loadSubset({})).then(
      () => {
        waiterOutcome = `resolved`
      },
      (error) => {
        waiterOutcome = `rejected`
        throw error
      },
    )

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    secondFocus.resolve(structuredClone(serverRows))
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(`idle`),
    )

    releaseHandler.resolve()
    await mutation.isPersisted.promise
    await waiter
    await vi.waitFor(() =>
      expect(itemIds(derived.toArray)).toEqual([initial.id, inserted.id]),
    )

    expect(waiterOutcome).toBe(`resolved`)
    expect(sourcePublications).not.toContainEqual([initial.id])
    for (const publication of sourcePublications) {
      expect([
        [initial.id, inserted.id],
        [initial.id, retired.id, inserted.id].sort(),
      ]).toContainEqual(publication)
    }
    expectMutationPublicationIntegrity(derivedPublications)
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
      derived: itemIds(derived.toArray),
    }).toEqual({
      cache: [initial.id, inserted.id],
      synced: [initial.id, inserted.id],
      source: [initial.id, inserted.id],
      derived: [initial.id, inserted.id],
    })

    queryClient.setQueryData(queryKey, [])
    await vi.waitFor(() => {
      expect({
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
        derived: itemIds(derived.toArray),
      }).toEqual({ synced: [], source: [], derived: [] })
    })
  })

  it(`removes rows superseded while an older result is publishing`, async () => {
    const id = `reentrant-committed-result-supersession`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const updated = { ...initial, name: `A from server` }
    const orphaned = { id: `c`, category: `result`, name: `C` }
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([initial, sibling]))
    const onUpdate = vi.fn(async () => {
      handlerEntered.resolve()
      await releaseHandler.promise
      return { refetch: false }
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onUpdate,
      }),
    )
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const mutation = collection.update(initial.id, (draft) => {
      draft.name = `A optimistic`
    })
    await handlerEntered.promise

    const publications: Array<Array<string>> = []
    let superseded = false
    const subscription = collection.subscribeChanges(() => {
      const ids = itemIds(collection.toArray)
      publications.push(ids)
      if (!superseded && ids.includes(orphaned.id)) {
        superseded = true
        queryClient.setQueryData(queryKey, [updated, sibling])
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    queryClient.setQueryData(queryKey, [updated, sibling, orphaned])
    expect(itemIds(collection._state.syncedData.values())).toEqual([
      initial.id,
      sibling.id,
    ])

    releaseHandler.resolve()
    await mutation.isPersisted.promise
    await collection._sync.loadSubset({})

    expect(queryFn).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(superseded).toBe(true)
    expect(publications).toContainEqual([initial.id, sibling.id, orphaned.id])
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
    }).toEqual({
      cache: [initial.id, sibling.id],
      synced: [initial.id, sibling.id],
      source: [initial.id, sibling.id],
    })
    expect(
      persistedOwners(collection._state.syncedMetadata, orphaned.id),
    ).toEqual([])
  })

  it(`retains ownership after a publication listener throws`, async () => {
    const id = `failed-result-publication`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const transient = { id: `c`, category: `result`, name: `C` }
    const publicationError = new Error(`Publication failed`)
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([initial, sibling]))
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
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
    cleanups.push(async () => {
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    let threw = false
    const subscription = collection.subscribeChanges(() => {
      if (!threw && collection.has(transient.id)) {
        threw = true
        throw publicationError
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    queryClient.setQueryData(queryKey, [initial, sibling, transient])
    await vi.waitFor(() => expect(threw).toBe(true))
    queryClient.setQueryData(queryKey, [initial, sibling])
    await collection._sync.loadSubset({})

    expect(queryFn).toHaveBeenCalledOnce()
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
    }).toEqual({
      cache: [initial.id, sibling.id],
      synced: [initial.id, sibling.id],
      source: [initial.id, sibling.id],
    })
    expect(
      persistedOwners(collection._state.syncedMetadata, transient.id),
    ).toEqual([])
  })

  it(`reports a reentrant initial replacement failure before readiness`, async () => {
    const id = `failed-initial-result-replacement`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const invalid = { id: `invalid`, category: `result`, name: `Invalid` }
    const applicationError = new Error(`Replacement application failed`)
    const firstResult = createDeferred<Array<Item>>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => firstResult.promise)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => {
          if (item.id === invalid.id) throw applicationError
          return item.id
        },
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      firstResult.resolve([initial])
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    collection.startSyncImmediate()
    expect(collection.status).toBe(`loading`)
    let replaced = false
    const subscription = collection.subscribeChanges(() => {
      if (!replaced && collection.has(initial.id)) {
        replaced = true
        queryClient.setQueryData(queryKey, [invalid])
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    firstResult.resolve([initial])
    await vi.waitFor(() => expect(collection.status).toBe(`error`))

    expect(queryFn).toHaveBeenCalledOnce()
    expect(replaced).toBe(true)
    expect(collection.utils.lastError).toBe(applicationError)
    expect(itemIds(collection.toArray)).toEqual([initial.id])
  })

  it(`releases provisional ownership when commit fails before publication`, async () => {
    const id = `failed-prepublication-commit`
    const detailSubset = { where: eq(`category`, `detail`) }
    const listSubset = { where: eq(`category`, `list`) }
    const detailKey = [id, getLoadSubsetDemandKey(detailSubset)] as const
    const detail = { id: `a`, category: `detail`, name: `A` }
    const list = { id: `c`, category: `list`, name: `C` }
    const commitError = new Error(`Commit failed before publication`)
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([detail])
      .mockResolvedValueOnce([list])
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const baseOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
    })
    const originalSync = baseOptions.sync
    let failNextCommit = false
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            commit: (signal) => {
              if (failNextCommit) {
                failNextCommit = false
                throw commitError
              }
              return params.commit(signal)
            },
          }),
      },
    })
    cleanups.push(async () => {
      collection._sync.unloadSubset(detailSubset)
      collection._sync.unloadSubset(listSubset)
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset(detailSubset)
    expect(itemIds(collection.toArray)).toEqual([detail.id])

    failNextCommit = true
    queryClient.setQueryData(detailKey, [detail, list])
    await vi.waitFor(() => expect(collection.utils.lastError).toBe(commitError))
    expect(itemIds(collection.toArray)).toEqual([detail.id])

    await collection._sync.loadSubset(listSubset)
    expect(itemIds(collection.toArray)).toEqual([detail.id, list.id])
    collection._sync.unloadSubset(listSubset)
    await vi.waitFor(() =>
      expect(itemIds(collection.toArray)).toEqual([detail.id]),
    )
  })

  it(`retires a publishing result when its final subset unloads`, async () => {
    const id = `reentrant-result-unload`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const updated = { ...initial, name: `A from server` }
    const orphaned = { id: `c`, category: `result`, name: `C` }
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([initial, sibling]))
    const onUpdate = vi.fn(async () => {
      handlerEntered.resolve()
      await releaseHandler.promise
      return { refetch: false }
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
        onUpdate,
      }),
    )
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    let unloaded = false
    const subscription = collection.subscribeChanges(() => {
      if (!unloaded && collection.has(orphaned.id)) {
        unloaded = true
        collection._sync.unloadSubset({})
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    const mutation = collection.update(initial.id, (draft) => {
      draft.name = `A optimistic`
    })
    await handlerEntered.promise
    queryClient.setQueryData(queryKey, [updated, sibling, orphaned])
    expect(itemIds(collection._state.syncedData.values())).toEqual([
      initial.id,
      sibling.id,
    ])

    releaseHandler.resolve()
    await mutation.isPersisted.promise
    await vi.waitFor(() => expect(unloaded).toBe(true))
    await vi.waitFor(() => {
      expect({
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
      }).toEqual({ synced: [], source: [] })
    })

    expect(queryFn).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(
      persistedOwners(collection._state.syncedMetadata, orphaned.id),
    ).toEqual([])
  })

  it(`retains post-publication ownership through durable persistence`, async () => {
    const id = `persisted-post-application-unload`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const transient = { id: `c`, category: `result`, name: `C` }
    const storage = createOwnershipStorage(undefined, 2)
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [initial, sibling])
    const createDerived = () =>
      createLiveQueryCollection((query) =>
        query.from({ item: collection }).select(({ item }) => ({ ...item })),
      )
    const firstDerived = createDerived()
    let secondDerived: ReturnType<typeof createDerived> | undefined

    try {
      await firstDerived.preload()
      expect(queryFn).toHaveBeenCalledOnce()
      expect(itemIds(storage.snapshot().rows.values())).toEqual([
        initial.id,
        sibling.id,
      ])

      queryClient.setQueryData(queryKey, [initial, sibling, transient])
      await storage.entered
      expect({
        synced: itemIds(collection._state.syncedData.values()),
        derived: itemIds(firstDerived.toArray),
        stored: itemIds(storage.snapshot().rows.values()),
      }).toEqual({
        synced: [initial.id, sibling.id, transient.id],
        derived: [initial.id, sibling.id, transient.id],
        stored: [initial.id, sibling.id],
      })

      await firstDerived.cleanup()
      storage.release()
      await vi.waitFor(() =>
        expect(itemIds(storage.snapshot().rows.values())).toEqual([
          initial.id,
          sibling.id,
          transient.id,
        ]),
      )

      queryClient.removeQueries({ queryKey, exact: true })
      secondDerived = createDerived()
      await secondDerived.preload()
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => {
        expect({
          synced: itemIds(collection._state.syncedData.values()),
          source: itemIds(collection.toArray),
          derived: itemIds(secondDerived?.toArray ?? []),
          stored: itemIds(storage.snapshot().rows.values()),
        }).toEqual({
          synced: [initial.id, sibling.id],
          source: [initial.id, sibling.id],
          derived: [initial.id, sibling.id],
          stored: [initial.id, sibling.id],
        })
      })
      expect(
        persistedOwners(storage.snapshot().rowMetadata, transient.id),
      ).toEqual([])
    } finally {
      storage.release()
      await secondDerived?.cleanup()
      if (firstDerived.status !== `cleaned-up`) await firstDerived.cleanup()
    }
  })

  it(`keeps only the newest cache result when publication reenters application`, async () => {
    const id = `reentrant-result-application`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const outer = { id: `b`, category: `result`, name: `B` }
    const inner = { id: `c`, category: `result`, name: `C` }
    const queryClient = createQueryClient()
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn: () => Promise.resolve([initial]),
        getKey: (item) => item.id,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const publications: Array<Array<string>> = []
    let injected = false
    const subscription = collection.subscribeChanges(() => {
      const ids = itemIds(collection.toArray)
      publications.push(ids)
      if (!injected && ids.includes(outer.id)) {
        injected = true
        queryClient.setQueryData(queryKey, [inner])
      }
    })
    cleanups.push(async () => subscription.unsubscribe())

    queryClient.setQueryData(queryKey, [outer])
    await vi.waitFor(() => expect(itemIds(collection.toArray)).toEqual([`c`]))

    expect(publications).toEqual([[`b`], [`c`]])
    queryClient.setQueryData(queryKey, [])
    await vi.waitFor(() => expect(collection.toArray).toEqual([]))
  })

  it(`retains a reentrant newer application failure for subset settlement`, async () => {
    const id = `reentrant-result-failure`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const outer = { id: `b`, category: `result`, name: `B` }
    const invalid = { id: `invalid`, category: `result`, name: `Invalid` }
    const applicationError = new Error(`newest result application failed`)
    const queryClient = createQueryClient()
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn: () => Promise.resolve([initial]),
        getKey: (item) => {
          if (item.id === invalid.id) throw applicationError
          return item.id
        },
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    let injected = false
    let pendingWaiter: Promise<void> | undefined
    const subscription = collection.subscribeChanges(() => {
      if (!injected && collection.has(outer.id)) {
        injected = true
        queryClient.setQueryData(queryKey, [invalid])
        pendingWaiter = expect(
          Promise.resolve(collection._sync.loadSubset({})),
        ).rejects.toBe(applicationError)
        void pendingWaiter.catch(() => {})
      }
    })
    cleanups.push(async () => subscription.unsubscribe())

    queryClient.setQueryData(queryKey, [outer])
    await vi.waitFor(() => expect(collection.utils.errorCount).toBe(1))
    await pendingWaiter
    await expect(Promise.resolve(collection._sync.loadSubset({}))).rejects.toBe(
      applicationError,
    )
  })

  it(`retires mutation ownership when a later cache result is empty`, async () => {
    const id = `mutation-ownership-replacement`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `mutation`, name: `A` }
    const inserted = { id: `b`, category: `mutation`, name: `B` }
    const serverRows = [initial]
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(serverRows)))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onInsert: ({ transaction }) => {
          serverRows.push(
            ...transaction.mutations.map(({ modified }) =>
              structuredClone(modified),
            ),
          )
          return Promise.resolve()
        },
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const mutation = collection.insert(inserted)
    await mutation.isPersisted.promise
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
    }).toEqual({ cache: [`a`, `b`], synced: [`a`, `b`], source: [`a`, `b`] })

    queryClient.setQueryData(queryKey, [])
    await vi.waitFor(() => {
      expect({
        cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
      }).toEqual({ cache: [], synced: [], source: [] })
    })
  })

  it(`publishes an authoritative delete after its mutation refetch`, async () => {
    const id = `mutation-delete-publication`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `mutation`, name: `A` }
    const serverRows = [initial]
    const queryClient = createQueryClient()
    const preexistingRefetchResult = createDeferred<Array<Item>>()
    const mutationRefetchResult = createDeferred<Array<Item>>()
    const persistenceGate = createDeferred<void>()
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    const commitRequests: Array<{
      writes: Array<string>
      receipt: `immediate` | `pending`
      outcome?: `applied` | `aborted` | `rejected`
    }> = []
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce(structuredClone(serverRows))
      .mockReturnValueOnce(preexistingRefetchResult.promise)
      .mockReturnValueOnce(mutationRefetchResult.promise)
    const baseOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey,
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
      onDelete: async ({ transaction }) => {
        await persistenceGate.promise
        const deleted = new Set(
          transaction.mutations.map(({ original }) => original.id),
        )
        serverRows.splice(
          0,
          serverRows.length,
          ...serverRows.filter(({ id: rowId }) => !deleted.has(rowId)),
        )
      },
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) => {
          let writes: Array<string> = []
          return originalSync.sync({
            ...params,
            metadata: recordMetadata(params.metadata!, metadata),
            begin: () => {
              writes = []
              params.begin()
            },
            write: (change) => {
              writes.push(change.type)
              params.write(change)
            },
            commit: (signal) => {
              const result = params.commit(signal)
              const request: (typeof commitRequests)[number] = {
                writes: [...writes],
                receipt: result === true ? `immediate` : `pending`,
              }
              commitRequests.push(request)
              if (result === true) {
                request.outcome = `applied`
              } else {
                void result.then(
                  () => {
                    request.outcome = `applied`
                  },
                  (error) => {
                    request.outcome = isCancelledError(error)
                      ? `aborted`
                      : `rejected`
                  },
                )
              }
              return result
            },
          })
        },
      },
    })
    const derived = createLiveQueryCollection((query) =>
      query.from({ item: collection }).select(({ item }) => ({
        id: item.id,
        category: item.category,
        name: item.name,
      })),
    )
    const capture = (): MutationLifecycleSnapshot => ({
      server: itemIds(serverRows),
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
      derived: itemIds(derived.toArray),
    })
    const publications: Array<MutationLifecycleSnapshot> = []
    const subscription = derived.subscribeChanges(() => {
      publications.push(capture())
    })
    cleanups.push(async () => {
      persistenceGate.resolve()
      preexistingRefetchResult.resolve([])
      mutationRefetchResult.resolve([])
      subscription.unsubscribe()
      await derived.cleanup()
      await collection.cleanup()
      queryClient.clear()
    })

    await derived.preload()
    expectMutationLifecycleSnapshot(
      capture(),
      [initial.id],
      [initial.id],
      false,
    )

    const preexistingRefetch = collection.utils.refetch({ throwOnError: true })
    void preexistingRefetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    const mutation = collection.delete(initial.id)
    expect(itemIds(collection.toArray)).toEqual([])
    expect(itemIds(derived.toArray)).toEqual([])

    persistenceGate.resolve()
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    mutationRefetchResult.resolve([])
    await mutation.isPersisted.promise

    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(commitRequests.some(({ writes }) => writes.includes(`delete`))).toBe(
      true,
    )
    expect(commitRequests.some(({ receipt }) => receipt === `pending`)).toBe(
      true,
    )
    expect(metadata.writes).toContainEqual({ type: `delete`, key: initial.id })
    await vi.waitFor(() =>
      expect(commitRequests.every(({ outcome }) => outcome !== undefined)).toBe(
        true,
      ),
    )
    expectMutationLifecycleSnapshot(capture(), [], [], false)
    expect(publications.at(-1)?.source).toEqual([])
    expect(publications.at(-1)?.derived).toEqual([])
  })

  it(`keeps cached rows until the final exact acquisition is released`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `shared-acquisition`,
      results: [[shared, detailOnly]],
    })
    const subset = { where: eq(`category`, `detail`) }

    await collection._sync.loadSubset(subset)
    await collection._sync.loadSubset(subset)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])

    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])
    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([])

    await collection._sync.loadSubset(subset)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])
  })

  it(`removes only rows whose final query owner is released`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `overlapping-acquisitions`,
      results: [
        [shared, detailOnly],
        [shared, listOnly],
      ],
    })
    const detail = { where: eq(`category`, `detail`) }
    const list = { where: eq(`category`, `list`) }

    await collection._sync.loadSubset(detail)
    await collection._sync.loadSubset(list)
    expect(rows(collection)).toEqual([detailOnly.id, listOnly.id, shared.id])

    collection._sync.unloadSubset(detail)
    expect(rows(collection)).toEqual([listOnly.id, shared.id])
    await collection._sync.loadSubset(detail)
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows(collection)).toEqual([detailOnly.id, listOnly.id, shared.id])

    collection._sync.unloadSubset(list)
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])
  })

  it.each([`remount`, `refetch`] as const)(
    `keeps eager rows idle after cache removal and recovers on %s`,
    async (action) => {
      const id = `eager-lifetime-owner`
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        syncMode: `eager`,
        results: [[shared], [{ ...shared, name: `Refetched` }]],
      })
      await collection.stateWhenReady()
      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      queryClient.removeQueries({ queryKey: [id], exact: true })

      expect(rows(collection)).toEqual([shared.id])
      await Promise.resolve()
      expect(queryFn).toHaveBeenCalledOnce()

      const remounted =
        action === `remount` ? collection.subscribeChanges(() => {}) : undefined
      if (action === `refetch`) await collection.utils.refetch()
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.get(shared.id)?.name).toBe(`Refetched`)
      })
      remounted?.unsubscribe()
    },
  )

  // Request data is reusable; each invocation still creates its own owner.
  // Cross startup with reference reuse and partial retirement, not only the
  // already-started observer path tested above.
  it.each(
    [2, 3].flatMap((owners) =>
      [false, true].flatMap((sharedReference) =>
        [0, 1, owners].map((retired) => ({
          owners,
          sharedReference,
          retired,
        })),
      ),
    ),
  )(
    `preserves startup ownership for $owners calls, shared reference $sharedReference, $retired retired`,
    async ({ owners, sharedReference, retired }) => {
      const id = `startup-owner-history`
      const subset = { where: eq(`category`, `shared`) }
      const queryHash = hashKey([id, getLoadSubsetDemandKey(subset)])
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [[shared]],
        setupMetadata: (metadata) =>
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
          }),
      })
      collection.startSyncImmediate()
      const requests = Array.from({ length: owners }, () =>
        sharedReference ? subset : { ...subset },
      )
      const results = Promise.allSettled(
        requests.map((request) => collection._sync.loadSubset(request)),
      )
      for (const request of requests.slice(0, retired)) {
        collection._sync.unloadSubset(request)
      }
      const outcomes = await results
      const live = owners - retired
      expect(
        outcomes.filter((outcome) => outcome.status === `fulfilled`),
      ).toHaveLength(live)
      const failures = outcomes.filter(
        (outcome) => outcome.status === `rejected`,
      )
      expect(failures).toHaveLength(retired)
      for (const failure of failures) {
        expect(failure.reason).toMatchObject({ name: `AbortError` })
      }
      expect(queryFn).toHaveBeenCalledTimes(live > 0 ? 1 : 0)
      const observedRows = () =>
        collection.toArray.map(({ id: rowId, category, name }) => ({
          id: rowId,
          category,
          name,
        }))
      expect(observedRows()).toEqual(live > 0 ? [shared] : [])
      for (let index = retired; index < owners; index++) {
        collection._sync.unloadSubset(requests[index]!)
        expect(observedRows()).toEqual(index + 1 < owners ? [shared] : [])
      }
    },
  )

  it.each([false, true])(
    `replaces an active eager cache entry with custom hash %s`,
    async (customHash) => {
      const id = `active-eager-custom-hash-${customHash}`
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        customHash,
        syncMode: `eager`,
        results: [[shared], [{ ...shared, name: `Replaced` }]],
      })
      await collection.stateWhenReady()
      const subscription = collection.subscribeChanges(() => {})
      try {
        queryClient.removeQueries({ queryKey: [id], exact: true })
        for (let turn = 0; turn < 20; turn++) await Promise.resolve()
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.get(shared.id)?.name).toBe(`Replaced`)
      } finally {
        subscription.unsubscribe()
      }
    },
  )

  it.each(
    [false, true].flatMap((mounted) =>
      [false, true].flatMap((customHash) =>
        [false, true].map((rejectOld) => ({ mounted, customHash, rejectOld })),
      ),
    ),
  )(
    `replaces a removed pending eager refetch without reviving idle demand: %j`,
    async ({ mounted, customHash, rejectOld }) => {
      const old = createDeferred<Array<Item>>()
      const next = createDeferred<Array<Item>>()
      const id = `pending-eager-removal`
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        customHash,
        syncMode: `eager`,
        results: [[shared], old.promise, next.promise],
      })
      await collection.stateWhenReady()
      let subscription = collection.subscribeChanges(() => {})
      if (!mounted) subscription.unsubscribe()
      let settled = false
      const refetch = collection.utils.refetch({ throwOnError: true }).then(
        () => {
          settled = true
        },
        (error: unknown) => {
          settled = true
          return error
        },
      )
      try {
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
        queryClient.removeQueries({ queryKey: [id], exact: true })
        for (let turn = 0; turn < 30; turn++) await Promise.resolve()
        expect(queryFn).toHaveBeenCalledTimes(mounted ? 3 : 2)
        expect(collection.get(shared.id)?.name).toBe(`Shared`)
        if (!mounted) subscription = collection.subscribeChanges(() => {})
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
        next.resolve([{ ...shared, name: `Current` }])
        await vi.waitFor(() =>
          expect(collection.get(shared.id)?.name).toBe(`Current`),
        )
        if (rejectOld) old.reject(new Error(`retired request failed`))
        else old.resolve([{ ...shared, name: `Obsolete` }])
        await vi.waitFor(() => expect(settled).toBe(true))
        expect(isCancelledError(await refetch)).toBe(true)
        expect(collection.get(shared.id)?.name).toBe(`Current`)
        expect(queryFn).toHaveBeenCalledTimes(3)
        expect(collection.status).toBe(`ready`)
      } finally {
        old.resolve([shared])
        next.resolve([shared])
        subscription.unsubscribe()
      }
    },
  )

  it.each(
    [0, Number.POSITIVE_INFINITY].flatMap((staleTime) =>
      [false, true].map((customHash) => ({ staleTime, customHash })),
    ),
  )(
    `starts only the requested fetch for an idle eager observer: %j`,
    async ({ staleTime, customHash }) => {
      const { collection, queryFn } = createOwnershipFixture({
        id: `idle-explicit-refetch`,
        syncMode: `eager`,
        staleTime,
        customHash,
        results: [[shared]],
      })
      await collection.stateWhenReady()
      queryFn.mockResolvedValue([{ ...shared, name: `Refetched` }])
      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()
      const before = queryFn.mock.calls.length
      const [result] = await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(before + 1)
      expect(collection.subscriberCount).toBe(0)
      expect((result?.data as Array<Item>)[0]?.name).toBe(`Refetched`)
      expect(collection.get(shared.id)?.name).toBe(`Refetched`)
    },
  )

  it.each([`release`, `cleanup`, `retain`] as const)(
    `honors %s during startup retention maintenance`,
    async (action) => {
      const id = `released-startup-retention`
      const subset = { where: eq(`category`, `shared`) }
      const key = `queryCollection:gc:${hashKey([id, getLoadSubsetDemandKey(subset)])}`
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [[shared]],
        setupMetadata: (metadata) =>
          metadata.collection.set(key, {
            queryHash: hashKey([id, getLoadSubsetDemandKey(subset)]),
            mode: `until-revalidated`,
          }),
      })
      collection.startSyncImmediate()
      const result = Promise.resolve(collection._sync.loadSubset(subset)).then(
        () => `ready`,
        (error: unknown) => error,
      )
      if (action === `release`) collection._sync.unloadSubset(subset)
      if (action === `cleanup`) await collection.cleanup()
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()
      if (action === `retain`) {
        expect(queryFn).toHaveBeenCalledTimes(1)
        await expect(result).resolves.toBe(`ready`)
        expect(collection.size).toBe(1)
      } else {
        expect(queryFn).not.toHaveBeenCalled()
        await expect(result).resolves.toMatchObject({ name: `AbortError` })
        expect(collection.size).toBe(0)
      }
    },
  )

  it.each([false, true])(
    `removes owned cache entries on cleanup with custom hash %s`,
    async (customHash) => {
      const id = `cleanup-custom-${customHash}`
      const { collection, queryClient } = createOwnershipFixture({
        id,
        customHash,
        syncMode: `eager`,
        results: [[shared]],
      })
      await collection.stateWhenReady()
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
      await collection.cleanup()
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    },
  )

  it(`settles an unfinished load when its final owner leaves`, async () => {
    const pending = createDeferred<Array<Item>>()
    const { collection } = createOwnershipFixture({
      id: `release-before-result`,
      results: [pending.promise],
    })
    const subset = { where: eq(`category`, `shared`) }
    let outcome: unknown = `pending`
    const load = Promise.resolve(collection._sync.loadSubset(subset)).then(
      () => {
        outcome = `ready`
      },
      (error: unknown) => {
        outcome = error
      },
    )
    try {
      expect(collection.isLoadingSubset).toBe(true)
      collection._sync.unloadSubset(subset)
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      expect(outcome).toMatchObject({ name: `AbortError` })
      expect(collection.isLoadingSubset).toBe(false)
      await load
    } finally {
      pending.resolve([shared])
    }
  })

  it(`keeps active on-demand rows when the Query cache entry departs`, async () => {
    const id = `active-cache-removal`
    const { collection, queryClient } = createOwnershipFixture({
      id,
      results: [[shared]],
    })
    const subset = { where: eq(`category`, `detail`) }
    await collection._sync.loadSubset(subset)

    queryClient.removeQueries({ queryKey: [id] })
    expect(rows(collection)).toEqual([shared.id])

    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([])
  })

  it(`keeps an inactive scoped cache isolated from another scope's manual write`, async () => {
    const id = `inactive-scoped-cache-isolation`
    const queryClient = createQueryClient()
    const sourceRows = new Map<string, Item>([
      [`1`, { id: `1`, category: `A`, name: `Category A` }],
      [`2`, { id: `2`, category: `B`, name: `Category B` }],
    ])
    const expectedByCategory = new Map<string, Array<string>>()
    const providerCalls: Array<string> = []
    let manualWrites = 0
    let remountReached = false
    let comparisonCount = 0

    const recomputeCategory = (category: string): Array<string> =>
      Array.from(sourceRows.values())
        .filter((row) => row.category === category)
        .map((row) => row.id)
        .sort()

    expectedByCategory.set(`A`, recomputeCategory(`A`))
    expectedByCategory.set(`B`, recomputeCategory(`B`))

    const queryFn = vi.fn((context: QueryFunctionContext) => {
      const where = context.meta?.loadSubsetOptions?.where
      const operands = where?.type === `func` ? where.args : []
      const categoryRef = operands.find(
        (operand) =>
          operand.type === `ref` &&
          operand.path.length === 1 &&
          operand.path[0] === `category`,
      )
      const categoryValue = operands.find(
        (operand) =>
          operand.type === `val` && typeof operand.value === `string`,
      )
      if (
        where?.type !== `func` ||
        where.name !== `eq` ||
        operands.length !== 2 ||
        categoryRef?.type !== `ref` ||
        categoryValue?.type !== `val` ||
        typeof categoryValue.value !== `string`
      ) {
        throw new Error(`Category fixture received an unsupported request`)
      }

      const category = categoryValue.value
      providerCalls.push(category)
      return Promise.resolve(
        Array.from(sourceRows.values(), (row) => structuredClone(row)).filter(
          (row) => row.category === category,
        ),
      )
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const createCategoryQuery = (category: string) =>
      createLiveQueryCollection({
        query: (query) =>
          query
            .from({ item: collection })
            .where(({ item }) => eq(item.category, category)),
      })

    type CategoryQuery = ReturnType<typeof createCategoryQuery>
    let inactiveCategoryA: CategoryQuery | undefined
    let activeCategoryB: CategoryQuery | undefined
    let remountedCategoryA: CategoryQuery | undefined

    try {
      inactiveCategoryA = createCategoryQuery(`A`)
      await inactiveCategoryA.preload()
      expect(rows(inactiveCategoryA)).toEqual(expectedByCategory.get(`A`))
      await inactiveCategoryA.cleanup()
      inactiveCategoryA = undefined

      activeCategoryB = createCategoryQuery(`B`)
      await activeCategoryB.preload()
      expect(rows(activeCategoryB)).toEqual(expectedByCategory.get(`B`))

      const added = { id: `3`, category: `B`, name: `New category B` }
      sourceRows.set(added.id, structuredClone(added))
      expectedByCategory.set(`B`, recomputeCategory(`B`))
      manualWrites++
      collection.utils.writeUpsert(structuredClone(added))
      const cacheEntriesAfterManualWrite = queryClient
        .getQueryCache()
        .findAll({ queryKey: [id] }).length

      remountedCategoryA = createCategoryQuery(`A`)
      await remountedCategoryA.preload()
      remountReached = true

      expect(providerCalls.slice(0, 2)).toEqual([`A`, `B`])
      expect(manualWrites).toBe(1)
      expect(remountReached).toBe(true)
      comparisonCount++
      expect(rows(remountedCategoryA)).toEqual(expectedByCategory.get(`A`))
      expect(comparisonCount).toBe(1)
      expect(cacheEntriesAfterManualWrite).toBe(1)
      expect(providerCalls.filter((category) => category === `A`)).toHaveLength(
        2,
      )
    } finally {
      await remountedCategoryA?.cleanup()
      await activeCategoryB?.cleanup()
      await inactiveCategoryA?.cleanup()
    }
  })

  it(`emits metadata for every owner of rows shared by overlapping queries`, async () => {
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    const { collection } = createOwnershipFixture({
      id: `persisted-overlap`,
      results: [[shared], [shared, listOnly]],
      metadataRecorder: metadata,
    })
    const detail = { where: eq(`category`, `detail`) }
    const list = { where: eq(`category`, `list`) }

    await collection._sync.loadSubset(detail)
    expect(persistedOwners(metadata.rows, shared.id)).toHaveLength(1)

    await collection._sync.loadSubset(list)
    expect(persistedOwners(metadata.rows, shared.id)).toHaveLength(2)
    expect(persistedOwners(metadata.rows, listOnly.id)).toHaveLength(1)

    collection._sync.unloadSubset(list)
    expect(rows(collection)).toEqual([shared.id])
    expect(persistedOwners(metadata.rows, shared.id)).toHaveLength(1)
  })

  it(`preserves committed peer ownership through a cold revalidation`, async () => {
    expectColdOwnerRevalidation(await observeColdOwnerRevalidation())
  })

  it(`rejects a superseded accepted result while publishing its successor`, async () => {
    const id = `superseded-retained-scan`
    const queryKey = [id] as const
    const queryHash = hashKey(queryKey)
    const initial = { id: `initial`, category: `retained`, name: `Initial` }
    const first = { id: `first`, category: `retained`, name: `First` }
    const second = { id: `second`, category: `retained`, name: `Second` }
    const initialScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const firstRefetchScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi
      .fn()
      .mockReturnValueOnce(initialScan.promise)
      .mockReturnValueOnce(firstRefetchScan.promise)
      .mockResolvedValue([])
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[initial], [first], [second]],
      syncMode: `eager`,
      scanPersistedRows,
      setupMetadata: (metadata) => {
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        })
      },
    })
    const publications: Array<Array<string>> = []
    const subscription = collection.subscribeChanges(() => {
      publications.push(itemIds(collection.toArray))
    })
    cleanups.push(() => {
      subscription.unsubscribe()
      return Promise.resolve()
    })
    cleanups.push(() => {
      initialScan.resolve([])
      firstRefetchScan.resolve([])
      return Promise.resolve()
    })

    await vi.waitFor(() => expect(scanPersistedRows).toHaveBeenCalledOnce())
    expect(queryFn).toHaveBeenCalledOnce()
    let model: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([[`query`, `none`]]),
    }
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 1,
      resultIds: [`query`],
      throwOnError: true,
    })
    const firstRefetch = collection.utils.refetch({ throwOnError: true })
    void firstRefetch.catch(() => {})
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(scanPersistedRows).toHaveBeenCalledTimes(2)
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: first.name,
    })

    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 2,
      resultIds: [`query`],
      throwOnError: true,
    })
    const secondRefetch = collection.utils.refetch({ throwOnError: true })
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(3)
      expect(collection.get(second.id)?.name).toBe(second.name)
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 2,
      resultId: `query`,
      value: second.name,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `retire-application`,
      callId: 1,
      resultId: `query`,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `fulfill-application`,
      callId: 2,
      resultId: `query`,
    })
    await secondRefetch
    expectExplicitRefetchObservation(
      {
        publicValues: { query: collection.get(second.id)?.name },
        refetch: `resolved`,
        resultOrder: [`query`],
      },
      observeExplicitRefetchApplication(model, 2),
    )

    firstRefetchScan.resolve([])
    await expect(firstRefetch).rejects.toMatchObject({ name: `AbortError` })
    expectExplicitRefetchObservation(
      {
        publicValues: { query: collection.get(second.id)?.name },
        refetch: `rejected`,
      },
      observeExplicitRefetchApplication(model, 1),
    )
    initialScan.resolve([])

    await vi.waitFor(() => {
      expect(itemIds(collection.toArray)).toEqual([second.id])
    })
    expect(publications).not.toContainEqual([initial.id])
    expect(publications).not.toContainEqual([first.id])
  })

  it(`rejects emitted ownership that is absent from cold storage`, async () => {
    const observations = await observeColdOwnerRevalidation(true)
    expect(() => expectColdOwnerRevalidation(observations)).toThrow()
  })

  it(`restages a persisted owner when its absent row arrives`, async () => {
    const id = `persisted-owner-before-row`
    const queryHash = hashKey([id])
    const result = createDeferred<Array<Item>>()
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    let setupCalls = 0
    const { collection, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [result.promise, [{ ...shared, name: `Restarted` }]],
      metadataRecorder: metadata,
      setupMetadata: (api) => {
        setupCalls++
        api.row.set(shared.id, {
          queryCollection: { owners: { [queryHash]: true } },
        })
      },
    })

    expect(rows(collection)).toEqual([])
    expect(persistedOwners(metadata.rows, shared.id)).toEqual([queryHash])
    result.resolve([shared])
    await collection.stateWhenReady()
    expect(rows(collection)).toEqual([shared.id])
    expect(persistedOwners(metadata.rows, shared.id)).toEqual([queryHash])

    await collection.cleanup()
    await collection.preload()
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.get(shared.id)?.name).toBe(`Restarted`)
    })
    expect(setupCalls).toBe(1)
    expect(persistedOwners(metadata.rows, shared.id)).toEqual([queryHash])
  })

  it(`stops after one failed post-write refetch`, async () => {
    const failedRefetch = createDeferred<Array<Item>>()
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { collection, queryFn } = createOwnershipFixture({
      id: `failed-post-write-refetch`,
      results: [[shared], failedRefetch.promise],
    })

    try {
      await collection._sync.loadSubset({})
      collection.utils.writeUpdate({ ...shared, name: `Manual` })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

      failedRefetch.reject(new Error(`Controlled refetch failure`))
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it(`keeps overlapping post-write refetches bounded`, async () => {
    const id = `overlapping-post-write-refetches`
    const queryClient = createQueryClient()
    const firstWriteResult = createDeferred<Array<Item>>()
    const secondWriteResult = createDeferred<Array<Item>>()
    const firstWriteStarted = createDeferred<void>()
    const secondWriteStarted = createDeferred<void>()
    let starts = 0
    let aborts = 0
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      starts++
      if (starts === 1) return Promise.resolve([shared])
      context.signal.addEventListener(`abort`, () => aborts++, { once: true })
      if (starts === 2) {
        firstWriteStarted.resolve()
        return firstWriteResult.promise
      }
      secondWriteStarted.resolve()
      return secondWriteResult.promise
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      firstWriteResult.resolve([])
      secondWriteResult.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    collection.utils.writeUpdate({ ...shared, name: `First write` })
    await firstWriteStarted.promise
    collection.utils.writeUpdate({ ...shared, name: `Second write` })
    await secondWriteStarted.promise
    for (let turn = 0; turn < 30; turn++) await Promise.resolve()

    expect({ starts, aborts }).toEqual({ starts: 3, aborts: 1 })
    secondWriteResult.resolve([{ ...shared, name: `Authoritative` }])
    await vi.waitFor(() => {
      expect(collection.get(shared.id)?.name).toBe(`Authoritative`)
    })
  })

  it(`accepts a successful foreign fetch as post-write authority`, async () => {
    const id = `foreign-post-write-authority`
    const queryClient = createQueryClient()
    const siblingOptions = categorySubset(`detail`)
    const siblingKey = [id, getLoadSubsetDemandKey(siblingOptions)]
    queryClient.setQueryData(siblingKey, [detailOnly])

    const foreignResult = { ...detailOnly, name: `Foreign authority` }
    const foreignQueryFn = vi.fn(() => Promise.resolve([foreignResult]))
    const foreignObserver = new QueryObserver(queryClient, {
      queryKey: siblingKey,
      queryFn: foreignQueryFn,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    })
    const unsubscribeForeign = foreignObserver.subscribe(() => {})
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      unsubscribeForeign()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    collection.utils.writeUpdate({ ...shared, name: `Manual` })
    await vi.waitFor(() => expect(foreignQueryFn).toHaveBeenCalledTimes(1))

    let settled = false
    const load = collection._sync.loadSubset(siblingOptions)
    void Promise.resolve(load === true ? undefined : load).then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    for (let turn = 0; turn < 30; turn++) await Promise.resolve()

    expect(settled).toBe(true)
    expect(foreignObserver.getCurrentResult().data).toEqual([foreignResult])
  })

  it(`uses the replacement Query when the cache is cleared before refetch`, async () => {
    const barrier = createDeferred<void>()
    const thirdFetch = createDeferred<Array<Item>>()
    const authoritative = { ...shared, name: `Authoritative` }
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id: `clear-before-post-write-refetch`,
      results: [[shared], [authoritative], thirdFetch.promise],
    })
    const barrierCompletion = barrier.promise.then(() => {
      collection.deferDataRefresh = null
    })

    try {
      await collection._sync.loadSubset({})
      collection.deferDataRefresh = barrier.promise
      collection.utils.writeUpdate({ ...shared, name: `Manual` })
      queryClient.clear()

      barrier.resolve()
      await barrierCompletion
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.get(shared.id)?.name).toBe(`Authoritative`)
    } finally {
      barrier.resolve()
      collection.deferDataRefresh = null
      thirdFetch.resolve([])
    }
  })

  it(`requires another fetch after cancellation reverts a raw result`, async () => {
    const id = `cancelled-post-write-refetch`
    const queryClient = createQueryClient()
    const cancelledResult = createDeferred<Array<Item>>()
    const cancelledStarted = createDeferred<void>()
    const authoritativeStarted = createDeferred<void>()
    const authoritative = { ...shared, name: `Authoritative` }
    let call = 0
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      call++
      if (call === 1) return Promise.resolve([shared])
      if (call === 2) {
        void context.signal.aborted
        cancelledStarted.resolve()
        return cancelledResult.promise
      }
      authoritativeStarted.resolve()
      return Promise.resolve([authoritative])
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      cancelledResult.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    collection.utils.writeUpdate({ ...shared, name: `Manual` })
    await cancelledStarted.promise

    const query = queryClient.getQueryCache().find({
      queryKey: [id],
      exact: true,
    })!
    await query.cancel({ revert: true })
    cancelledResult.resolve([{ ...shared, name: `Cancelled raw result` }])

    await authoritativeStarted.promise
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(3)
      expect(collection.get(shared.id)?.name).toBe(`Authoritative`)
    })
  })

  it(`removes unobserved sibling scopes without scanning or snapshots`, async () => {
    const id = `unobserved-sibling-manual-write`
    const queryClient = createQueryClient()
    const siblingKey = [id, `prefetched-sibling`]
    queryClient.setQueryData(siblingKey, [shared])
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    const findAll = vi.spyOn(queryClient.getQueryCache(), `findAll`)
    const values = vi.spyOn(collection._state.syncedData, `values`)

    collection.utils.writeDelete(shared.id)

    expect(queryClient.getQueryData(siblingKey)).toBeUndefined()
    expect(findAll).not.toHaveBeenCalled()
    expect(values).not.toHaveBeenCalled()
  })
})

it.each([false, true])(
  `evicts sibling caches created before sync starts, restart=%s`,
  async (restart) => {
    const queryClient = createQueryClient()
    const id = `delayed-sync-cache`
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([shared]),
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    if (restart) {
      collection.startSyncImmediate()
      await collection._sync.loadSubset({})
      await collection.cleanup()
    }
    const siblingKey = [id, `prefetched-sibling`]
    queryClient.setQueryData(siblingKey, [shared])
    collection.startSyncImmediate()
    await collection._sync.loadSubset({})
    collection.utils.writeDelete(shared.id)
    expect(queryClient.getQueryData(siblingKey)).toBeUndefined()
  },
)
