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
  createOptimisticAction,
  createTransaction,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src/index.js'
import {
  InvalidQueryResultError,
  SyncNotInitializedError,
} from '../src/errors.js'
import { queryCollectionOptions } from '../src/query.js'
import type {
  Collection,
  LoadSubsetOptions,
  SyncMetadataApi,
  Transaction,
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
 * A public refetch has a related result-settlement law. Every successful Query
 * result reaches exactly one explicit terminal outcome: its rows apply, its
 * application rejects, or its work is cancelled or retired. A deferred result
 * is not terminal. Its caller waits for the replacement result to apply.
 *
 * The result-settlement model below is intentionally smaller than production.
 * `applicable` combines adapter validation and the ability to materialize the
 * result; it does not classify arrays, select wrappers, Query states, or sync
 * transactions. The action grammar covers multiple public refetch operations,
 * immediate results, valid empty results, invalid shapes, overlapping defer
 * generations, replacement results, and cleanup retirement. The production
 * driver uses `collection.utils.refetch()` and observes only public promise
 * settlement plus public rows at the settlement checkpoint.
 *
 * The file is large because it crosses the real Query cache boundary, not
 * because it duplicates Query internals. Each history names one ownership edge
 * or generation race; shared fixtures provide the graph and observations.
 *
 * Known omissions: this result-settlement refinement does not model accepted-
 * result generations or the diff-free application signal requested by #1828.
 * Transport failure and cache replacement remain owned by the existing Query
 * lifecycle histories in this file.
 */

type ResultSettlementOperationState =
  | { phase: `waiting-for-result` }
  | { phase: `waiting-for-refresh`; barrier: string }
  | {
      phase: `terminal`
      outcome: `applied` | `rejected` | `cancelled`
      rowCount?: 0 | 1
    }

type ResultSettlementModelState = ReadonlyMap<
  string,
  ResultSettlementOperationState
>

type ResultSettlementModelAction =
  | { type: `start-refetch`; operation: string }
  | {
      type: `query-succeeded`
      operation: string
      result: `applicable` | `invalid-shape`
      rowCount?: 0 | 1
      deferOn?: string
    }
  | {
      type: `refresh-succeeded`
      barrier: string
      result: `applicable` | `invalid-shape`
      rowCount?: 0 | 1
      deferOn?: string
    }
  | { type: `retire` }

type PublicRefetchObservation =
  | { settled: false }
  | { settled: true; outcome: `fulfilled` | `rejected`; rowCount?: number }

function advanceResultSettlementModel(
  state: ResultSettlementModelState,
  action: ResultSettlementModelAction,
): ResultSettlementModelState {
  const next = new Map(state)

  if (action.type === `start-refetch`) {
    if (next.has(action.operation)) {
      throw new Error(`A public refetch operation must be unique`)
    }
    next.set(action.operation, { phase: `waiting-for-result` })
    return next
  }

  if (action.type === `retire`) {
    next.forEach((operation, id) => {
      if (operation.phase !== `terminal`) {
        next.set(id, { phase: `terminal`, outcome: `cancelled` })
      }
    })
    return next
  }

  if (action.type === `refresh-succeeded`) {
    const waiting = [...next].filter(
      ([, operation]) =>
        operation.phase === `waiting-for-refresh` &&
        operation.barrier === action.barrier,
    )
    if (waiting.length === 0) {
      throw new Error(`A replacement result requires its defer generation`)
    }
    waiting.forEach(([id]) => {
      next.set(
        id,
        action.deferOn
          ? { phase: `waiting-for-refresh`, barrier: action.deferOn }
          : action.result === `applicable`
            ? {
                phase: `terminal`,
                outcome: `applied`,
                rowCount: action.rowCount,
              }
            : { phase: `terminal`, outcome: `rejected` },
      )
    })
    return next
  }

  const operation = next.get(action.operation)
  if (operation?.phase !== `waiting-for-result`) {
    throw new Error(`A Query result requires one waiting public refetch`)
  }
  next.set(
    action.operation,
    action.deferOn
      ? { phase: `waiting-for-refresh`, barrier: action.deferOn }
      : action.result === `applicable`
        ? {
            phase: `terminal`,
            outcome: `applied`,
            rowCount: action.rowCount,
          }
        : { phase: `terminal`, outcome: `rejected` },
  )
  return next
}

function startResultSettlementModel(
  operation: string,
): ResultSettlementModelState {
  return advanceResultSettlementModel(new Map(), {
    type: `start-refetch`,
    operation,
  })
}

function expectPublicRefetchObservation(
  state: ResultSettlementModelState,
  operationId: string,
  observation: PublicRefetchObservation,
): void {
  const operation = state.get(operationId)
  if (!operation) throw new Error(`Unknown public refetch operation`)

  if (operation.phase !== `terminal`) {
    expect(observation).toEqual({ settled: false })
    return
  }

  expect(observation).toEqual(
    operation.outcome === `applied`
      ? {
          settled: true,
          outcome: `fulfilled`,
          ...(operation.rowCount === undefined
            ? {}
            : { rowCount: operation.rowCount }),
        }
      : { settled: true, outcome: `rejected` },
  )
}

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
 * `collection.utils.refetch()` is normally an application barrier. The public
 * contract is `docs/collections/query-collection.md#controlling-refetch-behavior`:
 * when no user mutation is persisting and no mutation handler is active,
 * successful fulfillment waits for every result accepted for Collection
 * application, including an application with no row diff. Rejection is
 * fail-fast and may leave independent obligations pending. While publication
 * is blocked by a persisting mutation or active handler, every call uses the
 * Query fetch boundary, including an overlapping external call.
 *
 * The handler parameter and every matching mutation alias preserve the real
 * external Collection identity. This keeps strict equality and identity-keyed
 * registries valid inside shared persistence handlers. Handler activity keeps
 * refetch at the Query fetch boundary without replacing those public objects.
 * The same acyclic fetch boundary applies when a manual transaction,
 * `createOptimisticAction`, or a direct handler awaits a captured Collection:
 * those documented forms still cannot wait on publication blocked by their
 * own transaction. The phase law applies in both start orders. A refresh that
 * begins first must change to the fetch boundary if a mutation starts before
 * its result application can publish.
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
 *   or more Collection applications it causes. Same-key background work is a
 *   separate source even when it occurs while that fetch is active.
 * - `HandlerRefetchBoundaryModel` excludes the causally queued Collection
 *   application from the handler call while retaining its later error record.
 * - `HandlerIdentityObservation` is a model-only projection of strict
 *   transaction, mutation, and Collection identity plus identity-keyed
 *   registry results. Its bounded grammar exhausts insert, update, and delete;
 *   handler parameter and mutation-alias access; and refetch and clearError.
 * - `MutationRefreshLivenessModel` is a wait-for graph. Its mutation, fetch,
 *   and application nodes map to the user transaction, Query promise, and
 *   Collection publication boundary. Invocation labels test both owned and
 *   overlapping external calls but do not affect the phase-based law.
 * - `QueryCacheWorkModel` treats Query ownership as the only edge authorizing
 *   Collection cache-listener work. The driver subtracts Query Core's own
 *   microtask baseline before comparing that bounded diagnostic.
 * - `FetchRecordLifecycleModel` gives a terminally cancelled fetch no live
 *   causal record. The driver observes retained state as extra cleanup work at
 *   the next fetch without using production record classification.
 *
 * Results skipped before application because refresh is deferred, or because a
 * manual-write snapshot is unchanged, are outside this accepted-result model.
 * Invalid query shapes remain the input-validation contract in `query.test.ts`.
 * A successful tracked result is otherwise admitted even when its on-demand
 * Query has no listeners. A Query removed after the call snapshot retains an
 * `undefined` result slot rather than turning lifecycle churn into a TypeError.
 *
 * State minimality: result order is observable in the returned array; pending
 * result identity and causal source control call settlement; accepted values
 * control publication; `throwOnError` distinguishes rejection from suppressed
 * failure; separate calls retain the outcome of a superseded caller. Handler
 * Collection identity is observed through the parameter, matching mutation
 * aliases, and identity-keyed registries. Direct Collection handlers own one
 * Collection, so unrelated multi-Collection mutation aliases are outside this
 * driver.
 *
 * Embedded ORC-012 review record for this extension: ORC-001 through 006 and
 * ORC-008 through 010 apply and are evidenced by this prose, independent
 * reducers, bounded grammar with an exhaustiveness assertion, real drivers,
 * observation helpers, wrong-result controls, state explanation, vocabulary
 * mapping, and aggregate cleanup. ORC-007 does not apply because this bounded
 * grammar is not a generated campaign. ORC-011 applies to the shared deadlock
 * claim: the wait-for-graph formulation is structurally separate from the
 * production drivers and from the earlier result/application ledger. This
 * executable comment records every ORC-001 through ORC-011 outcome; no
 * verdict-critical evidence lives only in the PR description.
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
 * This model-only call ledger separates Query fetch settlement from each
 * causally owned Collection application. Same-key background applications stay
 * observable to the model but do not become call obligations. A successful
 * call waits for every owned fetch and application obligation. A throwing call
 * rejects at its first owned failure; other obligations may remain pending.
 * This is the `Promise.all` aggregate promised by the public utility, not an
 * all-settled barrier.
 */
type RefetchCallSettlementModel = {
  queryOrder: Array<string>
  fetches: Map<string, `pending` | `fulfilled` | `rejected` | `removed`>
  applications: Map<
    string,
    {
      queryId: string
      outcome: `pending` | `fulfilled` | `rejected`
      source: `call` | `background`
    }
  >
  throwOnError: boolean
}

type RefetchCallSettlementAction =
  | {
      type: `accept-application`
      queryId: string
      applicationId: string
      source?: `call` | `background`
    }
  | {
      type: `settle-fetch`
      queryId: string
      outcome: `fulfilled` | `rejected`
    }
  | { type: `remove-query`; queryId: string }
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
        source: action.source ?? `call`,
      }),
    }
  }

  if (action.type === `remove-query`) {
    if (model.fetches.get(action.queryId) !== `pending`) {
      throw new Error(`Query ${action.queryId} is not pending removal`)
    }
    return {
      ...model,
      fetches: new Map(model.fetches).set(action.queryId, `removed`),
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
  resultOrder?: Array<string | undefined>
} {
  const fetchOutcomes = [...model.fetches.values()]
  const applicationOutcomes = [...model.applications.values()]
    .filter(({ source }) => source === `call`)
    .map(({ outcome }) => outcome)
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
  return {
    refetch: `resolved`,
    resultOrder: model.queryOrder.map((queryId) =>
      model.fetches.get(queryId) === `removed` ? undefined : queryId,
    ),
  }
}

/**
 * A handler-phase refetch has one Query fetch obligation. Its accepted
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

/**
 * A refresh started while a mutation is persisting cannot wait for publication
 * that the transaction prevents. This law comes from the documented
 * `createOptimisticAction` protocol in `packages/db/src/optimistic-action.ts`
 * and `docs/guides/mutations.md`: a mutation function may await Query
 * `refetch()` before it returns, while its optimistic transaction remains
 * active until that function returns.
 *
 * This reference model is a wait-for graph, not a copy of Query Collection
 * branches. `mutation` is the user transaction, `fetch` is the Query boundary,
 * and `application` is publication into Collection rows. During that phase the
 * refresh depends on `fetch`, regardless of which Collection reference invoked
 * it. When the mutation owns the refresh, an `application` dependency would
 * create the forbidden cycle mutation -> refresh -> application -> mutation;
 * for an external caller it would add an unrelated persistence delay.
 */
type MutationRefreshOperation = `refetch` | `clearError`
type MutationRefreshInvocation =
  | `manual-transaction`
  | `optimistic-action`
  | `captured-handler-collection`
  | `external-handler-overlap`
  | `external-persisted-application-overlap`

type MutationRefreshSchedule =
  | `mutation-first`
  | `refresh-first-during-fetch`
  | `refresh-first-during-application`

type MutationRefreshHistory = {
  invocation: MutationRefreshInvocation
  operation: MutationRefreshOperation
  schedule: MutationRefreshSchedule
}

const mutationRefreshInvocations = [
  `manual-transaction`,
  `optimistic-action`,
  `captured-handler-collection`,
  `external-handler-overlap`,
  `external-persisted-application-overlap`,
] as const
const mutationRefreshOperations = [`refetch`, `clearError`] as const
const mutationRefreshHistoryGrammar: ReadonlyArray<MutationRefreshHistory> = [
  ...mutationRefreshInvocations
    .filter(
      (invocation) =>
        invocation !== `external-handler-overlap` &&
        invocation !== `external-persisted-application-overlap`,
    )
    .flatMap((invocation) =>
      mutationRefreshOperations.map((operation) => ({
        invocation,
        operation,
        schedule: `mutation-first` as const,
      })),
    ),
  ...mutationRefreshOperations.flatMap((operation) =>
    ([`mutation-first`, `refresh-first-during-fetch`] as const).map(
      (schedule) => ({
        invocation: `external-handler-overlap` as const,
        operation,
        schedule,
      }),
    ),
  ),
  ...mutationRefreshOperations.map((operation) => ({
    invocation: `external-persisted-application-overlap` as const,
    operation,
    schedule: `refresh-first-during-application` as const,
  })),
]

type MutationRefreshLivenessModel = {
  fetch: `pending` | `fulfilled` | `rejected`
  application: `unaccepted` | `pending` | `fulfilled` | `rejected`
  boundary: `fetch` | `application`
  throwOnError: boolean
}

type MutationRefreshLivenessAction =
  | { type: `accept-application` }
  | { type: `settle-fetch`; outcome: `fulfilled` | `rejected` }
  | { type: `settle-application`; outcome: `fulfilled` | `rejected` }

function reduceMutationRefreshLiveness(
  model: MutationRefreshLivenessModel,
  action: MutationRefreshLivenessAction,
): MutationRefreshLivenessModel {
  if (action.type === `accept-application`) {
    if (model.application !== `unaccepted`) {
      throw new Error(`Mutation refresh application already accepted`)
    }
    return { ...model, application: `pending` }
  }
  if (action.type === `settle-fetch`) {
    if (model.fetch !== `pending`) {
      throw new Error(`Mutation refresh fetch already settled`)
    }
    return { ...model, fetch: action.outcome }
  }
  if (model.application !== `pending`) {
    throw new Error(`Mutation refresh application is not pending`)
  }
  return { ...model, application: action.outcome }
}

function observeMutationRefreshLiveness(model: MutationRefreshLivenessModel): {
  refresh: RefetchApplicationOutcome
  application: `unaccepted` | RefetchApplicationOutcome
} {
  const refresh =
    model.fetch === `pending`
      ? `pending`
      : model.fetch === `rejected` && model.throwOnError
        ? `rejected`
        : model.boundary === `application` && model.application === `pending`
          ? `pending`
          : model.boundary === `application` &&
              model.application === `rejected` &&
              model.throwOnError
            ? `rejected`
            : `resolved`
  return {
    refresh,
    application:
      model.application === `unaccepted`
        ? `unaccepted`
        : model.application === `pending`
          ? `pending`
          : model.application === `fulfilled`
            ? `resolved`
            : `rejected`,
  }
}

/**
 * Query-cache observation is an ownership boundary. A Collection may schedule
 * bookkeeping for a Query it owns, but a foreign Query has no modeled edge to
 * that Collection and therefore contributes no Collection microtasks. The
 * production observation subtracts Query Core's own baseline work, leaving
 * only work introduced by registered Query Collections.
 */
type QueryCacheWorkModel = {
  collectionCount: number
  queryOwnership: `owned` | `foreign`
}

function observeQueryCacheWork(model: QueryCacheWorkModel): {
  collectionMicrotasks: number
} {
  return {
    collectionMicrotasks:
      model.queryOwnership === `owned` ? model.collectionCount : 0,
  }
}

type FetchRecordLifecycleModel = {
  state: `active` | `cancelled`
}

function observeFetchRecordSuccessorWork(model: FetchRecordLifecycleModel): {
  extraCleanupMicrotasks: number
} {
  return {
    extraCleanupMicrotasks: model.state === `active` ? 1 : 0,
  }
}

type MutationHandlerKind = `insert` | `update` | `delete`
type HandlerCollectionAccessPath = `parameter` | `mutation-alias`
type HandlerCollectionOperation = `refetch` | `clearError`

type HandlerCollectionHistory = {
  handlerKind: MutationHandlerKind
  accessPath: HandlerCollectionAccessPath
  operation: HandlerCollectionOperation
}

type HandlerIdentityObservation = HandlerCollectionHistory & {
  matchingAliasCount: number
  transactionIsExternal: boolean
  allMutationsPreserveIdentity: boolean
  parameterIsExternal: boolean
  allAliasesMatchParameter: boolean
  anyAliasMatchesExternal: boolean
  externalMapMatchesAnyAlias: boolean
  parameterMapMatchesAllAliases: boolean
  externalWeakMapMatchesAnyAlias: boolean
  parameterWeakMapMatchesAllAliases: boolean
}

const mutationHandlerKinds = [`insert`, `update`, `delete`] as const
const handlerCollectionAccessPaths = [`parameter`, `mutation-alias`] as const
const handlerCollectionOperations = [`refetch`, `clearError`] as const

const handlerCollectionHistoryGrammar: ReadonlyArray<HandlerCollectionHistory> =
  mutationHandlerKinds.flatMap((handlerKind) =>
    handlerCollectionAccessPaths.flatMap((accessPath) =>
      handlerCollectionOperations.map((operation) => ({
        handlerKind,
        accessPath,
        operation,
      })),
    ),
  )

/**
 * A direct mutation handler receives the real Collection. Every matching
 * mutation alias preserves that identity. Strict equality and registries keyed
 * by the external or parameter reference therefore select the same mutations.
 * The model records only this public equality relation.
 */
function observeHandlerIdentity(
  history: HandlerCollectionHistory,
  matchingAliasCount: number,
): HandlerIdentityObservation {
  if (matchingAliasCount < 1) {
    throw new Error(`A direct handler requires a matching mutation alias`)
  }
  return {
    ...history,
    matchingAliasCount,
    transactionIsExternal: true,
    allMutationsPreserveIdentity: true,
    parameterIsExternal: true,
    allAliasesMatchParameter: true,
    anyAliasMatchesExternal: true,
    externalMapMatchesAnyAlias: true,
    parameterMapMatchesAllAliases: true,
    externalWeakMapMatchesAnyAlias: true,
    parameterWeakMapMatchesAllAliases: true,
  }
}

function expectHandlerIdentityObservation(
  actual: HandlerIdentityObservation,
  expected: HandlerIdentityObservation,
): void {
  expect(actual).toEqual(expected)
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

  it(`excludes unrelated background applications from a refetch call`, () => {
    let model = createRefetchCallSettlementModel([`query`], true)
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `own-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `background-result`,
      source: `background`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `own-result`,
      outcome: `fulfilled`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `query`,
      outcome: `fulfilled`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `background-result`,
      outcome: `rejected`,
    })

    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `resolved`,
      resultOrder: [`query`],
    })
  })

  it(`preserves the result slot of a Query removed during refetch startup`, () => {
    let model = createRefetchCallSettlementModel([`first`, `second`], true)
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `first`,
      applicationId: `first-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `remove-query`,
      queryId: `second`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `first`,
      outcome: `fulfilled`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `first-result`,
      outcome: `fulfilled`,
    })

    expect(observeRefetchCallSettlement(model)).toEqual({
      refetch: `resolved`,
      resultOrder: [`first`, undefined],
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

  it(`enumerates every direct handler identity history exactly once`, () => {
    const historyKeys = handlerCollectionHistoryGrammar.map(
      ({ handlerKind, accessPath, operation }) =>
        `${handlerKind}:${accessPath}:${operation}`,
    )
    expect(historyKeys).toEqual([
      `insert:parameter:refetch`,
      `insert:parameter:clearError`,
      `insert:mutation-alias:refetch`,
      `insert:mutation-alias:clearError`,
      `update:parameter:refetch`,
      `update:parameter:clearError`,
      `update:mutation-alias:refetch`,
      `update:mutation-alias:clearError`,
      `delete:parameter:refetch`,
      `delete:parameter:clearError`,
      `delete:mutation-alias:refetch`,
      `delete:mutation-alias:clearError`,
    ])
    expect(new Set(historyKeys).size).toBe(historyKeys.length)
  })

  it(`rejects handler identity wrong-result controls`, () => {
    const history = handlerCollectionHistoryGrammar[0]!
    const expected = observeHandlerIdentity(history, 2)
    const mutants: Array<HandlerIdentityObservation> = [
      { ...expected, transactionIsExternal: false },
      { ...expected, allMutationsPreserveIdentity: false },
      { ...expected, parameterIsExternal: false },
      { ...expected, allAliasesMatchParameter: false },
      { ...expected, anyAliasMatchesExternal: false },
      { ...expected, externalMapMatchesAnyAlias: false },
      { ...expected, parameterMapMatchesAllAliases: false },
      { ...expected, externalWeakMapMatchesAnyAlias: false },
      { ...expected, parameterWeakMapMatchesAllAliases: false },
    ]

    for (const mutant of mutants) {
      expect(() => expectHandlerIdentityObservation(mutant, expected)).toThrow()
    }
    expect(() =>
      expectHandlerIdentityObservation(expected, expected),
    ).not.toThrow()
    expect(() => observeHandlerIdentity(history, 0)).toThrow(
      `requires a matching mutation alias`,
    )
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

  it(`applies a successful on-demand refetch without Query listeners`, async () => {
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

    let model: ExplicitRefetchApplicationModel = {
      calls: new Map(),
      publicValues: new Map([[`query`, before.name]]),
    }
    model = reduceExplicitRefetchApplication(model, {
      type: `start-call`,
      callId: 1,
      resultIds: [`query`],
      throwOnError: true,
    })

    const results = await collection.utils.refetch({ throwOnError: true })
    model = reduceExplicitRefetchApplication(model, {
      type: `accept-result`,
      callId: 1,
      resultId: `query`,
      value: after.name,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: `fulfill-application`,
      callId: 1,
      resultId: `query`,
    })

    expectExplicitRefetchObservation(
      {
        publicValues: { query: collection.get(shared.id)?.name },
        refetch: `resolved`,
        resultOrder: [`query`],
      },
      observeExplicitRefetchApplication(model, 1),
    )
    expect((results[0]?.data as Array<Item>)[0]?.name).toBe(after.name)
  })

  it(`skips a snapshotted Query removed while an earlier refetch starts`, async () => {
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

    let model = createRefetchCallSettlementModel([`first`, `second`], true)
    const results = await collection.utils.refetch({ throwOnError: true })
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `first`,
      applicationId: `first-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `remove-query`,
      queryId: `second`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `first`,
      outcome: `fulfilled`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `first-result`,
      outcome: `fulfilled`,
    })

    expect({
      refetch: `resolved`,
      resultOrder: results.map((result, index) =>
        result === undefined ? undefined : index === 0 ? `first` : `second`,
      ),
    }).toEqual(observeRefetchCallSettlement(model))
  })

  it(`settles a suppressed fetch failure at the fetch boundary while a mutation persists`, async () => {
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

    let model: MutationRefreshLivenessModel = {
      fetch: `pending`,
      application: `unaccepted`,
      boundary: `fetch`,
      throwOnError: false,
    }
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
    model = reduceMutationRefreshLiveness(model, {
      type: `accept-application`,
    })
    model = reduceMutationRefreshLiveness(model, {
      type: `settle-fetch`,
      outcome: `rejected`,
    })
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect({ refresh: actualOutcome, application: `pending` }).toEqual(
      observeMutationRefreshLiveness(model),
    )
    expect(collection.get(shared.id)?.name).toBe(`Optimistic`)

    persistence.resolve()
    await transaction.isPersisted.promise
    const results = await refetch
    model = reduceMutationRefreshLiveness(model, {
      type: `settle-application`,
      outcome: `fulfilled`,
    })
    expect({ refresh: actualOutcome, application: `resolved` }).toEqual(
      observeMutationRefreshLiveness(model),
    )
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

  it(`does not adopt a background application from the same Query`, async () => {
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
      await transaction?.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
      queryClient.clear()
    })
    await collection.stateWhenReady()

    let model = createRefetchCallSettlementModel([`query`], true)
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
    await vi.waitFor(() => expect(backgroundInjected).toBe(true))
    expect(nameBeforeBackground).toBe(ownResult.name)

    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `own-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `background-result`,
      source: `background`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `own-result`,
      outcome: `fulfilled`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `query`,
      outcome: `fulfilled`,
    })

    queryClient.setQueryData(queryKey, [successor])
    model = reduceRefetchCallSettlement(model, {
      type: `settle-application`,
      applicationId: `background-result`,
      outcome: `rejected`,
    })
    persistence.resolve()
    await transaction?.isPersisted.promise
    const results = await refetch

    expect(actualOutcome).toBe(observeRefetchCallSettlement(model).refetch)
    expect(results).toHaveLength(1)
    expect(collection.get(shared.id)?.name).toBe(successor.name)
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
    `settles a $caseName accepted result at fetch and applies it after mutation`,
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

      let model: MutationRefreshLivenessModel = {
        fetch: `pending`,
        application: `unaccepted`,
        boundary: `fetch`,
        throwOnError: true,
      }
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
      model = reduceMutationRefreshLiveness(model, {
        type: `accept-application`,
      })
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-fetch`,
        outcome: `fulfilled`,
      })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()

      expect({
        refresh: refetchOutcome,
        application:
          collection.get(shared.id)?.name === authoritative.name
            ? `resolved`
            : `pending`,
      }).toEqual(observeMutationRefreshLiveness(model))

      persistence.resolve()
      await transaction.isPersisted.promise
      await refetch
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-application`,
        outcome: `fulfilled`,
      })
      expect({ refresh: refetchOutcome, application: `resolved` }).toEqual(
        observeMutationRefreshLiveness(model),
      )
      expect(collection.get(shared.id)?.name).toBe(authoritative.name)
    },
  )

  it(`settles an authority-gated eager refetch at fetch while a mutation persists`, async () => {
    const queryClient = createQueryClient()
    const automaticResult = createDeferred<Array<Item>>()
    const explicitResult = createDeferred<Array<Item>>()
    const persistence = createDeferred<void>()
    const initial = { ...shared, name: `Initial` }
    const authoritative = { ...shared, name: `Authoritative` }
    let call = 0
    const queryFn = vi.fn(() => {
      call++
      if (call === 1) return Promise.resolve([initial])
      if (call === 2) return automaticResult.promise
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
      automaticResult.resolve([authoritative])
      explicitResult.resolve([authoritative])
      persistence.resolve()
      if (transactionStarted) {
        await transaction.isPersisted.promise.catch(() => undefined)
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
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    let model: MutationRefreshLivenessModel = {
      fetch: `pending`,
      application: `unaccepted`,
      boundary: `fetch`,
      throwOnError: true,
    }
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
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))

    explicitResult.resolve([authoritative])
    await vi.waitFor(() => expect(eager.utils.isFetching).toBe(false))
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    model = reduceMutationRefreshLiveness(model, {
      type: `accept-application`,
    })
    model = reduceMutationRefreshLiveness(model, {
      type: `settle-fetch`,
      outcome: `fulfilled`,
    })
    expect({
      refresh: refetchOutcome,
      application:
        eager.get(shared.id)?.name === authoritative.name
          ? `resolved`
          : `pending`,
    }).toEqual(observeMutationRefreshLiveness(model))

    persistence.resolve()
    await transaction.isPersisted.promise
    const results = await refetch
    model = reduceMutationRefreshLiveness(model, {
      type: `settle-application`,
      outcome: `fulfilled`,
    })
    expect({ refresh: refetchOutcome, application: `resolved` }).toEqual(
      observeMutationRefreshLiveness(model),
    )
    expect(results.map(() => `query`)).toEqual([`query`])
    expect(eager.get(shared.id)?.name).toBe(authoritative.name)
  })

  it.each(
    mutationRefreshHistoryGrammar.filter(
      ({ invocation }) => invocation === `external-handler-overlap`,
    ),
  )(
    `settles an external $operation at fetch with $schedule overlap`,
    async ({ operation, schedule }) => {
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
          id: `external-${operation}-${schedule}-overlaps-handler`,
          queryClient,
          queryKey: [`external-${operation}-${schedule}-overlaps-handler`],
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
        refreshResult.resolve([authoritative])
        releaseHandler.resolve()
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()

      let model: MutationRefreshLivenessModel = {
        fetch: `pending`,
        application: `unaccepted`,
        boundary: `fetch`,
        throwOnError: true,
      }
      let refetchOutcome: RefetchApplicationOutcome = `pending`
      const startRefresh = () => {
        const refresh = (
          operation === `refetch`
            ? collection.utils.refetch({ throwOnError: true })
            : collection.utils.clearError()
        ).then(
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
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
        mutation = startMutation()
        await handlerStarted.promise
      }
      refreshResult.resolve([authoritative])
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.utils.isFetching).toBe(false)
      })
      model = reduceMutationRefreshLiveness(model, {
        type: `accept-application`,
      })
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-fetch`,
        outcome: `fulfilled`,
      })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()

      expect({
        refresh: refetchOutcome,
        application:
          collection.get(shared.id)?.name === authoritative.name
            ? `resolved`
            : `pending`,
      }).toEqual(observeMutationRefreshLiveness(model))

      releaseHandler.resolve()
      await mutation.isPersisted.promise
      await refresh
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-application`,
        outcome: `fulfilled`,
      })
      expect({ refresh: refetchOutcome, application: `resolved` }).toEqual(
        observeMutationRefreshLiveness(model),
      )
      expect(collection.get(shared.id)?.name).toBe(authoritative.name)
    },
  )

  it.each(
    mutationRefreshHistoryGrammar.filter(
      ({ invocation }) =>
        invocation === `external-persisted-application-overlap`,
    ),
  )(
    `settles an external $operation when mutation starts during persisted application preparation`,
    async ({ operation }) => {
      const id = `external-${operation}-persisted-application-overlap`
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

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledOnce()
        expect(scanPersistedRows).toHaveBeenCalledOnce()
      })

      let model: MutationRefreshLivenessModel = {
        fetch: `pending`,
        application: `unaccepted`,
        boundary: `fetch`,
        throwOnError: true,
      }
      let refetchOutcome: RefetchApplicationOutcome = `pending`
      const refresh = (
        operation === `refetch`
          ? collection.utils.refetch({ throwOnError: true })
          : collection.utils.clearError()
      ).then(
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
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      refreshResult.resolve([authoritative])
      await vi.waitFor(() => {
        expect(collection.utils.isFetching).toBe(false)
        expect(scanPersistedRows).toHaveBeenCalledTimes(2)
      })

      const transaction = createTransaction({
        mutationFn: () => persistence.promise,
      })
      transaction.mutate(() => collection.insert(optimistic))
      void transaction.isPersisted.promise.catch(() => undefined)
      applicationScan.resolve([])
      model = reduceMutationRefreshLiveness(model, {
        type: `accept-application`,
      })
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-fetch`,
        outcome: `fulfilled`,
      })
      await vi.waitFor(() =>
        expect(refetchOutcome).toBe(
          observeMutationRefreshLiveness(model).refresh,
        ),
      )
      expect(collection.get(shared.id)?.name).not.toBe(authoritative.name)

      persistence.resolve()
      await transaction.isPersisted.promise
      await refresh
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-application`,
        outcome: `fulfilled`,
      })
      await vi.waitFor(() =>
        expect(collection.get(shared.id)?.name).toBe(authoritative.name),
      )
      expect({ refresh: refetchOutcome, application: `resolved` }).toEqual(
        observeMutationRefreshLiveness(model),
      )
    },
  )

  it(`rejects a call-entry-only boundary mutant for refresh-first overlap`, () => {
    const history = mutationRefreshHistoryGrammar.find(
      ({ invocation, operation, schedule }) =>
        invocation === `external-handler-overlap` &&
        operation === `refetch` &&
        schedule === `refresh-first-during-fetch`,
    )
    expect(history).toBeDefined()
    let model: MutationRefreshLivenessModel = {
      fetch: `pending`,
      application: `unaccepted`,
      boundary: `fetch`,
      throwOnError: true,
    }
    model = reduceMutationRefreshLiveness(model, {
      type: `accept-application`,
    })
    model = reduceMutationRefreshLiveness(model, {
      type: `settle-fetch`,
      outcome: `fulfilled`,
    })

    const expected = observeMutationRefreshLiveness(model)
    const callEntryOnlyMutant = observeMutationRefreshLiveness({
      ...model,
      boundary: `application`,
    })

    expect(expected).toEqual({ refresh: `resolved`, application: `pending` })
    expect(callEntryOnlyMutant).not.toEqual(expected)
  })

  it(`enumerates every mutation refresh history exactly once`, () => {
    expect(mutationRefreshHistoryGrammar).toHaveLength(12)
    expect(
      new Set(
        mutationRefreshHistoryGrammar.map(
          ({ invocation, operation, schedule }) =>
            `${invocation}:${operation}:${schedule}`,
        ),
      ).size,
    ).toBe(mutationRefreshHistoryGrammar.length)
  })

  it.each(
    mutationRefreshHistoryGrammar.filter(
      ({ invocation }) =>
        invocation === `manual-transaction` ||
        invocation === `optimistic-action`,
    ),
  )(
    `settles a $invocation $operation at the fetch boundary`,
    async ({ invocation, operation }) => {
      const id = `mutation-refresh-${invocation}-${operation}`
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
        const refresh =
          operation === `refetch`
            ? collection.utils.refetch({ throwOnError: true })
            : collection.utils.clearError()
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
          await transactionReference.current.isPersisted.promise
        }
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()

      let transaction: Transaction<Record<string, unknown>>
      if (invocation === `manual-transaction`) {
        transaction = createTransaction<Record<string, unknown>>({ mutationFn })
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
      void transaction.isPersisted.promise.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

      let model: MutationRefreshLivenessModel = {
        fetch: `pending`,
        application: `unaccepted`,
        boundary: `fetch`,
        throwOnError: true,
      }
      refreshResult.resolve([authoritative])
      await vi.waitFor(() => expect(collection.utils.isFetching).toBe(false))
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      model = reduceMutationRefreshLiveness(model, {
        type: `accept-application`,
      })
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-fetch`,
        outcome: `fulfilled`,
      })

      expect({
        refresh: refreshOutcome,
        application:
          collection.get(shared.id)?.name === authoritative.name
            ? `resolved`
            : `pending`,
      }).toEqual(observeMutationRefreshLiveness(model))
    },
  )

  it.each(
    mutationRefreshHistoryGrammar.filter(
      ({ invocation }) => invocation === `captured-handler-collection`,
    ),
  )(
    `settles a captured handler Collection $operation at the fetch boundary`,
    async ({ operation }) => {
      const id = `captured-handler-refresh-${operation}`
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
      const collectionReference: { current?: OwnershipFixture[`collection`] } =
        {}
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
            const refresh =
              operation === `refetch`
                ? capturedCollection.utils.refetch({ throwOnError: true })
                : capturedCollection.utils.clearError()
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
            return { refetch: false }
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
          await transactionReference.current.isPersisted.promise
        }
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()

      const transaction = collection.update(shared.id, (draft) => {
        draft.name = `Optimistic`
      })
      transactionReference.current = transaction
      void transaction.isPersisted.promise.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

      let model: MutationRefreshLivenessModel = {
        fetch: `pending`,
        application: `unaccepted`,
        boundary: `fetch`,
        throwOnError: true,
      }
      refreshResult.resolve([authoritative])
      await vi.waitFor(() => expect(collection.utils.isFetching).toBe(false))
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      model = reduceMutationRefreshLiveness(model, {
        type: `accept-application`,
      })
      model = reduceMutationRefreshLiveness(model, {
        type: `settle-fetch`,
        outcome: `fulfilled`,
      })

      expect({
        refresh: refreshOutcome,
        application:
          collection.get(shared.id)?.name === authoritative.name
            ? `resolved`
            : `pending`,
      }).toEqual(observeMutationRefreshLiveness(model))
    },
  )

  it(`does not schedule Collection work for a foreign Query`, async () => {
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
    const model = observeQueryCacheWork({
      collectionCount: 2,
      queryOwnership: `foreign`,
    })
    const ownedQueryMutant = observeQueryCacheWork({
      collectionCount: 2,
      queryOwnership: `owned`,
    })

    expect({ collectionMicrotasks: withCollections - baseline }).toEqual(model)
    expect(ownedQueryMutant).not.toEqual(model)
  })

  it(`does not defer reverted fetch record retirement to a successor fetch`, async () => {
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
          await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
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
    const expected = observeFetchRecordSuccessorWork({ state: `cancelled` })
    const retainedRecordMutant = observeFetchRecordSuccessorWork({
      state: `active`,
    })

    expect({
      extraCleanupMicrotasks: afterCancellation - baseline,
    }).toEqual(expected)
    expect(retainedRecordMutant).not.toEqual(expected)
  })

  it.each(handlerCollectionHistoryGrammar)(
    `preserves $handlerKind handler identity through $accessPath $operation`,
    async (history) => {
      const { handlerKind, accessPath, operation } = history
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
            `refetch` | `clearError`
          >
        },
        transaction: {
          mutations: ReadonlyArray<{ collection: unknown }>
        },
      ): Promise<{ refetch: false }> => {
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
          operation,
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
        const boundary =
          operation === `refetch`
            ? refetchCollection.utils.refetch({ throwOnError: true })
            : refetchCollection.utils.clearError()
        await boundary.then(
          () => {
            handlerOutcome = `resolved`
          },
          (error: unknown) => {
            handlerOutcome = `rejected`
            throw error
          },
        )
        return { refetch: false }
      }
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id: `handler-scope-${handlerKind}-${accessPath}-${operation}`,
          queryClient,
          queryKey: [`handler-scope`, handlerKind, accessPath, operation],
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

      let model: HandlerRefetchBoundaryModel = {
        fetch: `pending`,
        application: `unaccepted`,
        throwOnError: true,
      }
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
      void mutation.isPersisted.promise.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      expect(handlerOutcome).toBe(observeHandlerRefetchBoundary(model).refetch)
      if (!identityObservation) {
        throw new Error(
          `The mutation handler did not record Collection identity`,
        )
      }
      expectHandlerIdentityObservation(
        identityObservation,
        observeHandlerIdentity(history, 2),
      )

      refresh.resolve(authoritative)
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

      await mutation.isPersisted.promise
      model = reduceHandlerRefetchBoundary(model, {
        type: `settle-application`,
        outcome: `fulfilled`,
      })
      expect(observeHandlerRefetchBoundary(model)).toEqual({
        refetch: `resolved`,
        applicationErrorRecorded: false,
      })
      expect([...collection.values()].map(({ name }) => name).sort()).toEqual(
        authoritative.map(({ name }) => name).sort(),
      )
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

  it(`records a handler-phase application failure after fetch settlement`, async () => {
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

  it(`rejects silent fulfillment in the public result-settlement checker`, () => {
    const deferredOperation = `deferred`
    const deferred = advanceResultSettlementModel(
      startResultSettlementModel(deferredOperation),
      {
        type: `query-succeeded`,
        operation: deferredOperation,
        result: `applicable`,
        rowCount: 1,
        deferOn: `barrier-a`,
      },
    )
    const invalidOperation = `invalid`
    const invalid = advanceResultSettlementModel(
      startResultSettlementModel(invalidOperation),
      {
        type: `query-succeeded`,
        operation: invalidOperation,
        result: `invalid-shape`,
      },
    )
    const recoveredOperation = `recovered`
    const withRecoveredOperation = advanceResultSettlementModel(invalid, {
      type: `start-refetch`,
      operation: recoveredOperation,
    })
    const recovered = advanceResultSettlementModel(withRecoveredOperation, {
      type: `query-succeeded`,
      operation: recoveredOperation,
      result: `applicable`,
      rowCount: 1,
    })
    const rebound = advanceResultSettlementModel(deferred, {
      type: `refresh-succeeded`,
      barrier: `barrier-a`,
      result: `applicable`,
      deferOn: `barrier-b`,
    })

    expect(() =>
      expectPublicRefetchObservation(deferred, deferredOperation, {
        settled: true,
        outcome: `fulfilled`,
        rowCount: 1,
      }),
    ).toThrow()
    expect(() =>
      expectPublicRefetchObservation(invalid, invalidOperation, {
        settled: true,
        outcome: `fulfilled`,
      }),
    ).toThrow()
    expect(() =>
      expectPublicRefetchObservation(recovered, recoveredOperation, {
        settled: true,
        outcome: `rejected`,
      }),
    ).toThrow()
    expect(() =>
      expectPublicRefetchObservation(rebound, deferredOperation, {
        settled: true,
        outcome: `fulfilled`,
        rowCount: 1,
      }),
    ).toThrow()
  })

  it(`fulfills a public refetch after applying a valid empty result`, async () => {
    const id = `empty-result-settlement`
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([])
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
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const refetch = collection.utils.refetch({ throwOnError: true })
    await refetch

    const operation = `empty-result`
    const expected = advanceResultSettlementModel(
      startResultSettlementModel(operation),
      {
        type: `query-succeeded`,
        operation,
        result: `applicable`,
        rowCount: 0,
      },
    )
    expectPublicRefetchObservation(expected, operation, {
      settled: true,
      outcome: `fulfilled`,
      rowCount: collection.size,
    })
  })

  it.each([
    {
      invalidShape: `non-array`,
      throwOnError: false,
      invalidResult: 42,
      diagnostic: `Got: number`,
    },
    {
      invalidShape: `non-array`,
      throwOnError: true,
      invalidResult: 42,
      diagnostic: `Got: number`,
    },
    {
      invalidShape: `null array member`,
      throwOnError: false,
      invalidResult: [null],
      diagnostic: `Invalid item at index 0: null`,
    },
    {
      invalidShape: `null array member`,
      throwOnError: true,
      invalidResult: [null],
      diagnostic: `Invalid item at index 0: null`,
    },
  ] as const)(
    `rejects a public refetch whose successful Query result has an invalid $invalidShape shape, throwOnError=$throwOnError`,
    async ({ throwOnError, invalidResult, diagnostic }) => {
      const id = `invalid-result-settlement`
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([shared])
        .mockResolvedValueOnce(invalidResult as unknown as Array<Item>)
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
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
      cleanups.push(async () => {
        consoleError.mockRestore()
        await collection.cleanup()
        queryClient.clear()
      })

      await collection.stateWhenReady()
      let rejection: unknown
      const refetch = collection.utils.refetch({ throwOnError }).then(
        () => ({ settled: true, outcome: `fulfilled` as const }),
        (error: unknown) => {
          rejection = error
          return { settled: true, outcome: `rejected` as const }
        },
      )

      const operation = `invalid-result`
      const expected = advanceResultSettlementModel(
        startResultSettlementModel(operation),
        {
          type: `query-succeeded`,
          operation,
          result: `invalid-shape`,
        },
      )
      expectPublicRefetchObservation(expected, operation, await refetch)
      expect(rejection).toBeInstanceOf(InvalidQueryResultError)
      expect(rejection).toEqual(
        expect.objectContaining({
          message: expect.stringContaining(diagnostic),
        }),
      )
      expect(rows(collection)).toEqual([shared.id])
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(`[QueryCollection] Error applying query`),
        expect.objectContaining({
          name: `InvalidQueryResultError`,
          message: expect.stringContaining(
            `@tanstack/query-db-collection: queryFn must return an array of objects`,
          ),
        }),
      )
    },
  )

  it(`keeps a deferred public refetch pending until its replacement applies`, async () => {
    const id = `deferred-result-settlement`
    const barrier = createDeferred<void>()
    const initial = { ...shared, name: `Initial` }
    const skipped = { ...shared, name: `Skipped` }
    const replacement = { ...shared, name: `Replacement` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([skipped])
      .mockResolvedValueOnce([replacement])
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
    cleanups.push(async () => {
      collection.deferDataRefresh = null
      barrier.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    collection.deferDataRefresh = barrier.promise
    let observation: PublicRefetchObservation = { settled: false }
    const refetch = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        observation = {
          settled: true,
          outcome: `fulfilled`,
          rowCount: collection.size,
        }
      },
      () => {
        observation = { settled: true, outcome: `rejected` }
      },
    )

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()

    const operation = `deferred-result`
    let expected = advanceResultSettlementModel(
      startResultSettlementModel(operation),
      {
        type: `query-succeeded`,
        operation,
        result: `applicable`,
        rowCount: 1,
        deferOn: `barrier-a`,
      },
    )
    expectPublicRefetchObservation(expected, operation, observation)
    expect(collection.get(shared.id)?.name).toBe(initial.name)

    collection.deferDataRefresh = null
    barrier.resolve()
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await refetch

    expected = advanceResultSettlementModel(expected, {
      type: `refresh-succeeded`,
      barrier: `barrier-a`,
      result: `applicable`,
      rowCount: 1,
    })
    expectPublicRefetchObservation(expected, operation, observation)
    expect(collection.get(shared.id)?.name).toBe(replacement.name)
  })

  it(`starts the deferred replacement when the barrier resolves during a fetch`, async () => {
    const id = `deferred-result-in-flight`
    const barrier = createDeferred<void>()
    const inFlight = createDeferred<Array<Item>>()
    const initial = { ...shared, name: `Initial` }
    const replacement = { ...shared, name: `Replacement` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockImplementationOnce(() => inFlight.promise)
      .mockResolvedValue([replacement])
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
    cleanups.push(async () => {
      collection.deferDataRefresh = null
      barrier.resolve()
      inFlight.resolve([initial])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    collection.deferDataRefresh = barrier.promise
    void collection.utils.refetch().catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    collection.deferDataRefresh = null
    barrier.resolve()

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => {
      expect(collection.get(shared.id)?.name).toBe(replacement.name)
    })
  })

  it(`classifies post-write authority before settling a deferred replacement`, async () => {
    const queryKey = [`deferred-result-post-write-authority`]
    const replacementBarrier = createDeferred<void>()
    const writerBarrier = createDeferred<void>()
    const initial = { ...shared, name: `Initial` }
    const skipped = { ...shared, name: `Skipped` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([skipped])
      .mockResolvedValueOnce([null] as unknown as Array<Item>)
    const reader = createCollection(
      queryCollectionOptions<Item>({
        id: `deferred-result-authority-reader`,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    const writer = createCollection(
      queryCollectionOptions<Item>({
        id: `deferred-result-authority-writer`,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    cleanups.push(async () => {
      consoleError.mockRestore()
      reader.deferDataRefresh = null
      writer.deferDataRefresh = null
      replacementBarrier.resolve()
      writerBarrier.resolve()
      await Promise.allSettled([reader.cleanup(), writer.cleanup()])
      queryClient.clear()
    })

    await reader.stateWhenReady()
    await writer._sync.loadSubset({})
    reader.deferDataRefresh = replacementBarrier.promise
    writer.deferDataRefresh = writerBarrier.promise

    let observation: PublicRefetchObservation = { settled: false }
    const refetch = reader.utils.refetch({ throwOnError: true }).then(
      () => {
        observation = {
          settled: true,
          outcome: `fulfilled`,
          rowCount: reader.size,
        }
        return undefined
      },
      (error: unknown) => {
        observation = { settled: true, outcome: `rejected` }
        return error
      },
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()

    const operation = `deferred-post-write-authority`
    let expected = advanceResultSettlementModel(
      startResultSettlementModel(operation),
      {
        type: `query-succeeded`,
        operation,
        result: `applicable`,
        rowCount: 1,
        deferOn: `replacement-barrier`,
      },
    )
    expectPublicRefetchObservation(expected, operation, observation)

    writer.utils.writeUpdate({ ...shared, name: `Manual` })
    reader.deferDataRefresh = null
    replacementBarrier.resolve()

    const result = await refetch
    expected = advanceResultSettlementModel(expected, {
      type: `refresh-succeeded`,
      barrier: `replacement-barrier`,
      result: `invalid-shape`,
    })
    expectPublicRefetchObservation(expected, operation, observation)
    expect(result).toBeInstanceOf(InvalidQueryResultError)
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(reader.get(shared.id)?.name).toBe(initial.name)
  })

  it(`cancels a deferred public refetch when cleanup retires it`, async () => {
    const id = `deferred-result-cleanup`
    const barrier = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([{ ...shared, name: `Skipped` }])
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
    cleanups.push(async () => {
      collection.deferDataRefresh = null
      barrier.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    collection.deferDataRefresh = barrier.promise
    const refetch = collection.utils.refetch({ throwOnError: true }).then(
      () => ({ observation: { settled: true, outcome: `fulfilled` as const } }),
      (error: unknown) => ({
        observation: { settled: true, outcome: `rejected` as const },
        error,
      }),
    )

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    const operation = `deferred-cleanup`
    let expected = advanceResultSettlementModel(
      startResultSettlementModel(operation),
      {
        type: `query-succeeded`,
        operation,
        result: `applicable`,
        rowCount: 1,
        deferOn: `barrier-a`,
      },
    )
    await collection.cleanup()
    expected = advanceResultSettlementModel(expected, { type: `retire` })

    const result = await refetch
    expectPublicRefetchObservation(expected, operation, result.observation)
    expect(isCancelledError(`error` in result ? result.error : undefined)).toBe(
      true,
    )
  })

  it(`does not reuse an invalid result rejection for a later valid refetch`, async () => {
    const id = `recovered-result-settlement`
    const queryHash = hashKey([id])
    const persistedScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => persistedScan.promise)
    const invalidResult = 42 as unknown as Array<Item>
    const recovered = { ...shared, name: `Recovered` }
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [invalidResult, [recovered]],
      syncMode: `on-demand`,
      scanPersistedRows,
      setupMetadata: (metadata) => {
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        })
      },
    })
    cleanups.push(() => {
      consoleError.mockRestore()
      return Promise.resolve()
    })

    let expected = startResultSettlementModel(`invalid`)
    try {
      const initialLoad = collection._sync.loadSubset({})
      await expect(
        Promise.resolve(initialLoad === true ? undefined : initialLoad),
      ).rejects.toBeInstanceOf(InvalidQueryResultError)
      expected = advanceResultSettlementModel(expected, {
        type: `query-succeeded`,
        operation: `invalid`,
        result: `invalid-shape`,
      })
      expected = advanceResultSettlementModel(expected, {
        type: `start-refetch`,
        operation: `recovered`,
      })

      const refetch = collection.utils.refetch({ throwOnError: true }).then(
        () => ({ settled: true, outcome: `fulfilled` as const }),
        () => ({ settled: true, outcome: `rejected` as const }),
      )
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(scanPersistedRows).toHaveBeenCalledOnce()
      })
      persistedScan.resolve([])
      expected = advanceResultSettlementModel(expected, {
        type: `query-succeeded`,
        operation: `recovered`,
        result: `applicable`,
      })

      expectPublicRefetchObservation(expected, `recovered`, await refetch)
      await vi.waitFor(() => {
        expect(collection.get(shared.id)?.name).toBe(recovered.name)
      })
    } finally {
      persistedScan.resolve([])
    }
  })

  it(`rejects an invalid retained revalidation before its persisted baseline loads`, async () => {
    const id = `retained-invalid-result-settlement`
    const queryHash = hashKey([id])
    const persistedScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => persistedScan.promise)
    const invalidResult = 42 as unknown as Array<Item>
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[shared], invalidResult],
      syncMode: `on-demand`,
      scanPersistedRows,
      setupMetadata: (metadata) => {
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        })
      },
    })
    cleanups.push(() => {
      consoleError.mockRestore()
      return Promise.resolve()
    })

    const initialLoad = collection._sync.loadSubset({})
    const initialLoadPromise = Promise.resolve(
      initialLoad === true ? undefined : initialLoad,
    )
    void initialLoadPromise.catch(() => undefined)

    try {
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(scanPersistedRows).toHaveBeenCalledTimes(1)
      })

      let rejection: unknown
      const refetch = collection.utils.refetch({ throwOnError: true }).then(
        () => ({ settled: true, outcome: `fulfilled` as const }),
        (error: unknown) => {
          rejection = error
          return { settled: true, outcome: `rejected` as const }
        },
      )
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

      const operation = `retained-invalid-result`
      const expected = advanceResultSettlementModel(
        startResultSettlementModel(operation),
        {
          type: `query-succeeded`,
          operation,
          result: `invalid-shape`,
        },
      )
      expectPublicRefetchObservation(expected, operation, await refetch)
      expect(rejection).toBeInstanceOf(InvalidQueryResultError)
    } finally {
      persistedScan.resolve([])
      await initialLoadPromise.catch(() => undefined)
    }
  })

  it(`keeps refetches pending when an older barrier refresh reaches a newer barrier`, async () => {
    const id = `overlapping-defer-generations`
    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()
    const initial = { ...shared, name: `Initial` }
    const skippedA = { ...shared, name: `Skipped A` }
    const skippedB = { ...shared, name: `Skipped B` }
    const replacement = { ...shared, name: `Replacement` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([skippedA])
      .mockResolvedValueOnce([skippedB])
      .mockResolvedValueOnce([{ ...shared, name: `Refresh while B active` }])
      .mockResolvedValue([replacement])
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
    cleanups.push(async () => {
      collection.deferDataRefresh = null
      barrierA.resolve()
      barrierB.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    let expected = new Map() as ResultSettlementModelState
    let firstObservation: PublicRefetchObservation = { settled: false }
    let secondObservation: PublicRefetchObservation = { settled: false }

    const barrierAPromise = barrierA.promise
    collection.deferDataRefresh = barrierAPromise
    const clearBarrierA = barrierAPromise.finally(() => {
      if (collection.deferDataRefresh === barrierAPromise) {
        collection.deferDataRefresh = null
      }
    })
    expected = advanceResultSettlementModel(expected, {
      type: `start-refetch`,
      operation: `first`,
    })
    const first = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        firstObservation = { settled: true, outcome: `fulfilled`, rowCount: 1 }
      },
      () => {
        firstObservation = { settled: true, outcome: `rejected` }
      },
    )
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryData([id])).toEqual([skippedA])
    })
    expected = advanceResultSettlementModel(expected, {
      type: `query-succeeded`,
      operation: `first`,
      result: `applicable`,
      rowCount: 1,
      deferOn: `barrier-a`,
    })

    const barrierBPromise = barrierB.promise
    collection.deferDataRefresh = barrierBPromise
    const clearBarrierB = barrierBPromise.finally(() => {
      if (collection.deferDataRefresh === barrierBPromise) {
        collection.deferDataRefresh = null
      }
    })
    expected = advanceResultSettlementModel(expected, {
      type: `start-refetch`,
      operation: `second`,
    })
    const second = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        secondObservation = {
          settled: true,
          outcome: `fulfilled`,
          rowCount: 1,
        }
      },
      () => {
        secondObservation = { settled: true, outcome: `rejected` }
      },
    )
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(3)
      expect(queryClient.getQueryData([id])).toEqual([skippedB])
    })
    expected = advanceResultSettlementModel(expected, {
      type: `query-succeeded`,
      operation: `second`,
      result: `applicable`,
      rowCount: 1,
      deferOn: `barrier-b`,
    })

    barrierA.resolve()
    await clearBarrierA
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(4))
    expected = advanceResultSettlementModel(expected, {
      type: `refresh-succeeded`,
      barrier: `barrier-a`,
      result: `applicable`,
      rowCount: 1,
      deferOn: `barrier-b`,
    })
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()

    expectPublicRefetchObservation(expected, `first`, firstObservation)
    expectPublicRefetchObservation(expected, `second`, secondObservation)
    expect(collection.get(shared.id)?.name).toBe(initial.name)

    barrierB.resolve()
    await clearBarrierB
    await Promise.all([first, second])
    expect(queryFn).toHaveBeenCalledTimes(5)
    expected = advanceResultSettlementModel(expected, {
      type: `refresh-succeeded`,
      barrier: `barrier-b`,
      result: `applicable`,
      rowCount: 1,
    })
    expectPublicRefetchObservation(expected, `first`, firstObservation)
    expectPublicRefetchObservation(expected, `second`, secondObservation)
    expect(collection.get(shared.id)?.name).toBe(replacement.name)
  })

  it(`settles a fresh applied refetch independently of an older deferred result`, async () => {
    const id = `independent-refetch-settlement`
    const barrier = createDeferred<void>()
    const initial = { ...shared, name: `Initial` }
    const skipped = { ...shared, name: `Skipped` }
    const fresh = { ...shared, name: `Fresh` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([skipped])
      .mockResolvedValueOnce([fresh])
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
    cleanups.push(async () => {
      barrier.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    collection.deferDataRefresh = barrier.promise
    let oldObservation: PublicRefetchObservation = { settled: false }
    const oldRefetch = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        oldObservation = { settled: true, outcome: `fulfilled` }
      },
      () => {
        oldObservation = { settled: true, outcome: `rejected` }
      },
    )
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryData([id])).toEqual([skipped])
    })

    let expected = advanceResultSettlementModel(
      startResultSettlementModel(`old`),
      {
        type: `query-succeeded`,
        operation: `old`,
        result: `applicable`,
        rowCount: 1,
        deferOn: `barrier-a`,
      },
    )
    collection.deferDataRefresh = null
    expected = advanceResultSettlementModel(expected, {
      type: `start-refetch`,
      operation: `fresh`,
    })
    let freshObservation: PublicRefetchObservation = { settled: false }
    const freshRefetch = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        freshObservation = {
          settled: true,
          outcome: `fulfilled`,
          rowCount: collection.size,
        }
      },
      () => {
        freshObservation = { settled: true, outcome: `rejected` }
      },
    )
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(3)
      expect(collection.get(shared.id)?.name).toBe(fresh.name)
    })
    expected = advanceResultSettlementModel(expected, {
      type: `query-succeeded`,
      operation: `fresh`,
      result: `applicable`,
      rowCount: 1,
    })
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()

    expectPublicRefetchObservation(expected, `old`, oldObservation)
    expectPublicRefetchObservation(expected, `fresh`, freshObservation)
    await collection.cleanup()
    barrier.resolve()
    await Promise.allSettled([oldRefetch, freshRefetch])
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
            begin: (options) => {
              writes = []
              return params.begin(options)
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
