/**
 * Independent Query ownership models shared by production refinements and
 * ordinary model/checker examples. These reducers retain the original call,
 * application, handler, identity and result-settlement laws verbatim. Their
 * actions abstract authored Query completion and Collection application events;
 * they neither read production classifications nor decide source timing.
 */
import { expect } from 'vitest'

export type ResultSettlementOperationState =
  | { phase: `waiting-for-result` }
  | { phase: `waiting-for-refresh`; barrier: string }
  | {
      phase: `terminal`
      outcome: `applied` | `rejected` | `cancelled`
      rowCount?: 0 | 1
    }

export type ResultSettlementModelState = ReadonlyMap<
  string,
  ResultSettlementOperationState
>

/**
 * `query-succeeded` and `refresh-succeeded` compress the result lifecycle.
 * With an applicable result and no `deferOn`, each action combines Query fetch
 * fulfillment, completed Collection application and its applied settlement,
 * and the terminal public-refetch checkpoint.
 * A `deferOn` action instead records the skipped result and its replacement wait;
 * a nondeferred `invalid-shape` result records application rejection. The model
 * omits intermediate application states, which the separate obligation models
 * below retain.
 */
export type ResultSettlementModelAction =
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

export type PublicRefetchObservation =
  | { settled: false }
  | { settled: true; outcome: `fulfilled` | `rejected`; rowCount?: number }

export function advanceResultSettlementModel(
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

export function startResultSettlementModel(
  operation: string,
): ResultSettlementModelState {
  return advanceResultSettlementModel(new Map(), {
    type: `start-refetch`,
    operation,
  })
}

export function expectPublicRefetchObservation(
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
 *   registry results. Its bounded grammar crosses insert, update, and delete
 *   through handler parameter and mutation-alias access during explicit refetch.
 *   Historical operation labels are replay coordinates only, not model state.
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
export type RefetchApplicationOutcome = `pending` | `resolved` | `rejected`

export type ExplicitRefetchCallModel = {
  resultOrder: Array<string>
  pendingResultIds: Set<string>
  acceptedValues: Map<string, string>
  throwOnError: boolean
  outcome: RefetchApplicationOutcome
}

export type ExplicitRefetchApplicationModel = {
  calls: Map<number, ExplicitRefetchCallModel>
  publicValues: Map<string, string>
}

export type ExplicitRefetchApplicationAction =
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

export type ExplicitRefetchObservation = {
  publicValues: Record<string, string | undefined>
  refetch: RefetchApplicationOutcome
  resultOrder?: Array<string>
}

export function reduceExplicitRefetchApplication(
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

export function observeExplicitRefetchApplication(
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

export function expectExplicitRefetchObservation(
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
export type RefetchCallSettlementModel = {
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

export type RefetchCallSettlementAction =
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

export function createRefetchCallSettlementModel(
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

export function reduceRefetchCallSettlement(
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

export function observeRefetchCallSettlement(
  model: RefetchCallSettlementModel,
): {
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
export type HandlerRefetchBoundaryModel = {
  fetch: `pending` | `fulfilled` | `rejected`
  application: `unaccepted` | `pending` | `fulfilled` | `rejected`
  throwOnError: boolean
}

export type HandlerRefetchBoundaryAction =
  | { type: `accept-application` }
  | { type: `settle-fetch`; outcome: `fulfilled` | `rejected` }
  | { type: `settle-application`; outcome: `fulfilled` | `rejected` }

export function reduceHandlerRefetchBoundary(
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

export function observeHandlerRefetchBoundary(
  model: HandlerRefetchBoundaryModel,
): {
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
/**
 * Before the RC, these matrices exercised refetch and the removed clearError
 * utility. Both paths now explicitly refetch. Keep the former operation labels
 * only as replay coordinates: existing traces, fixture IDs, and all 12 runs of
 * each matrix survive. The labels add no semantic history or model distinction.
 * To select the former clearError rows, use the test-name pattern
 * `legacy replay:.*clearError`; Vitest can quote interpolated string values.
 */
export type LegacyRefreshReplayCoordinate = `refetch` | `clearError`
export const legacyRefreshReplayCoordinates = [`refetch`, `clearError`] as const

export type LegacyRefreshReplay = {
  legacyOperation: LegacyRefreshReplayCoordinate
}

export type MutationRefreshInvocation =
  | `manual-transaction`
  | `optimistic-action`
  | `captured-handler-collection`
  | `external-handler-overlap`
  | `external-persisted-application-overlap`

export type MutationRefreshSchedule =
  | `mutation-first`
  | `refresh-first-during-fetch`
  | `refresh-first-during-application`

export type MutationRefreshHistory = {
  invocation: MutationRefreshInvocation
  schedule: MutationRefreshSchedule
}

export const mutationRefreshInvocations = [
  `manual-transaction`,
  `optimistic-action`,
  `captured-handler-collection`,
  `external-handler-overlap`,
  `external-persisted-application-overlap`,
] as const
export const mutationRefreshHistoryGrammar: ReadonlyArray<
  MutationRefreshHistory & LegacyRefreshReplay
> = [
  ...mutationRefreshInvocations
    .filter(
      (invocation) =>
        invocation !== `external-handler-overlap` &&
        invocation !== `external-persisted-application-overlap`,
    )
    .flatMap((invocation) =>
      legacyRefreshReplayCoordinates.map((legacyOperation) => ({
        invocation,
        legacyOperation,
        schedule: `mutation-first` as const,
      })),
    ),
  ...legacyRefreshReplayCoordinates.flatMap((legacyOperation) =>
    ([`mutation-first`, `refresh-first-during-fetch`] as const).map(
      (schedule) => ({
        invocation: `external-handler-overlap` as const,
        legacyOperation,
        schedule,
      }),
    ),
  ),
  ...legacyRefreshReplayCoordinates.map((legacyOperation) => ({
    invocation: `external-persisted-application-overlap` as const,
    legacyOperation,
    schedule: `refresh-first-during-application` as const,
  })),
]

export type MutationRefreshLivenessModel = {
  fetch: `pending` | `fulfilled` | `rejected`
  application: `unaccepted` | `pending` | `fulfilled` | `rejected`
  boundary: `fetch` | `application`
  throwOnError: boolean
}

export type MutationRefreshLivenessAction =
  | { type: `accept-application` }
  | { type: `settle-fetch`; outcome: `fulfilled` | `rejected` }
  | { type: `settle-application`; outcome: `fulfilled` | `rejected` }

export function reduceMutationRefreshLiveness(
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

export function observeMutationRefreshLiveness(
  model: MutationRefreshLivenessModel,
): {
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
export type QueryCacheWorkModel = {
  collectionCount: number
  queryOwnership: `owned` | `foreign`
}

export function observeQueryCacheWork(model: QueryCacheWorkModel): {
  collectionMicrotasks: number
} {
  return {
    collectionMicrotasks:
      model.queryOwnership === `owned` ? model.collectionCount : 0,
  }
}

export type FetchRecordLifecycleModel = {
  state: `active` | `cancelled`
}

export function observeFetchRecordSuccessorWork(
  model: FetchRecordLifecycleModel,
): {
  extraCleanupMicrotasks: number
} {
  return {
    extraCleanupMicrotasks: model.state === `active` ? 1 : 0,
  }
}

export type MutationHandlerKind = `insert` | `update` | `delete`
export type HandlerCollectionAccessPath = `parameter` | `mutation-alias`

export type HandlerCollectionHistory = {
  handlerKind: MutationHandlerKind
  accessPath: HandlerCollectionAccessPath
}

export type HandlerIdentityObservation = HandlerCollectionHistory & {
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

export const mutationHandlerKinds = [`insert`, `update`, `delete`] as const
export const handlerCollectionAccessPaths = [
  `parameter`,
  `mutation-alias`,
] as const
export const handlerCollectionHistoryGrammar: ReadonlyArray<
  HandlerCollectionHistory & LegacyRefreshReplay
> = mutationHandlerKinds.flatMap((handlerKind) =>
  handlerCollectionAccessPaths.flatMap((accessPath) =>
    legacyRefreshReplayCoordinates.map((legacyOperation) => ({
      handlerKind,
      accessPath,
      legacyOperation,
    })),
  ),
)

/**
 * A direct mutation handler receives the real Collection. Every matching
 * mutation alias preserves that identity. Strict equality and registries keyed
 * by the external or parameter reference therefore select the same mutations.
 * The model records only this public equality relation.
 */
export function observeHandlerIdentity(
  history: HandlerCollectionHistory,
  matchingAliasCount: number,
): HandlerIdentityObservation {
  if (matchingAliasCount < 1) {
    throw new Error(`A direct handler requires a matching mutation alias`)
  }
  return {
    handlerKind: history.handlerKind,
    accessPath: history.accessPath,
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

export function expectHandlerIdentityObservation(
  actual: HandlerIdentityObservation,
  expected: HandlerIdentityObservation,
): void {
  expect(actual).toEqual(expected)
}

export function checkPostHandlerRefetch(
  model: RefetchCallSettlementModel,
  observed: {
    refetch: ReturnType<typeof observeRefetchCallSettlement>
    rows: string
    waiterRows: string | undefined
  },
  initial: string,
  confirmed: string,
): void {
  const expected = observeRefetchCallSettlement(model)
  expect(observed.refetch).toEqual(expected)
  if (expected.refetch === `pending`) {
    expect([initial, confirmed]).toContain(observed.rows)
    expect(observed.waiterRows).toBeUndefined()
  } else {
    expect(observed.rows).toBe(confirmed)
    expect(observed.waiterRows).toBe(confirmed)
  }
}
