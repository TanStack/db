import { hashKey, isCancelledError } from '@tanstack/query-core'
import {
  DbClient,
  IR,
  collectionOptions,
  createCollection,
  createOptimisticAction,
  createTransaction,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { createDeferred } from '../../db/src/deferred.js'
import {
  compileSingleRowExpression,
  toBooleanPredicate,
} from '../../db/src/query/compiler/evaluators.js'

import { InvalidQueryResultError } from '../src/errors.js'
import { queryCollectionOptions } from '../src/query.js'
import {
  categorySubset,
  cleanups,
  createOwnershipFixture,
  createOwnershipStorage,
  createPersistedOwnershipFixture,
  createQueryClient,
  detailOnly,
  itemIds,
  listOnly,
  persistedOwners,
  rows,
  runCleanups,
  shared,
  storedItems,
} from './ownership-lifecycle-support.js'
import type { LoadSubsetOptions, Transaction } from '@tanstack/db'
import type { QueryClient, QueryFunctionContext } from '@tanstack/query-core'

import type { QueryCollectionUtils } from '../src/query.js'
import type {
  Item,
  MetadataRecorder,
  OwnershipFixture,
} from './ownership-lifecycle-support.js'

/**
 * # Who owns a Query-backed row, and when may it disappear?
 *
 * Query cache entries acquire rows for one or more exact subset demands. A row
 * remains public while any committed owner needs it. Provisional ownership
 * begins during result application, becomes durable only after publication and
 * persistence, and retires when superseded, canceled, cleaned up, or released.
 * Mutation refetches add a second authority path but do not bypass those rules.
 * An accepted direct write changes its Collection without starting a Query
 * request. In eager mode, compatible Collections sharing a physical Query
 * project representable cache patches made by either writer. In on-demand
 * mode, a direct write leaves a Query owned by another Collection untouched;
 * a later peer cannot publish another writer's patched cache as a server
 * result. A later physical fetch may replace the direct row, while a disabled
 * on-demand peer waits for explicit refetch. These claims cover one
 * QueryClient; hydration into another client loses local-patch provenance.
 *
 * The reference view is an ownership graph: query scope and demand nodes point
 * to row keys. Sync-run lifetime fences, direct-write key positions, and
 * defer-result barriers govern competing results. Publication and persistence
 * are separate commit boundaries. Tests use real QueryClient
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
 * immediate results, valid empty results, invalid shapes, eager recovery,
 * overlapping defer generations, replacement results, cleanup retirement, and
 * same-result subscriber reentry with a controlled nested applied receipt.
 * The production driver crosses eager and on-demand ownership. It observes
 * public promise settlement and public rows at the settlement checkpoint.
 * The model does not track Query fetch counters or observer scheduling.
 *
 * The file is large because it crosses the real Query cache boundary, not
 * because it duplicates Query internals. Each history names one ownership edge
 * or generation race; shared fixtures provide the graph and observations.
 * Managed SQLite rotation retires every old Query result, acquisition, and
 * retention scan. Active demands reacquire from a post-rotation fetch; a late
 * refetch cancels instead of returning unapplied old data. The real SQLite
 * histories below compare public rows and caller settlement at both sides of
 * the rotation and at the later stale-work release cut.
 *
 * Known omissions: this result-settlement refinement does not model accepted-
 * result generations or the diff-free application signal requested by #1828.
 * Transport failure and cache replacement remain owned by the existing Query
 * lifecycle histories in this file.
 * Direct write receipts have a separate boundary: a Query Collection write
 * settles when its sync commit applies. The controlled persisted-owner history
 * below holds that commit after the initial fetch, then checks the returned
 * promise and stored row before and after release. It does not model native
 * SQLite failure or overlapping on-demand explicit refetches.
 * Direct writes belong to the current sync run. Cleanup start invalidates that
 * run, so later writes must fail without changing storage. Restart admits
 * writes through a new run. The fixed history below checks each boundary.
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

/**
 * ## A reacquired observer lease owns the current Query result
 *
 * Law: reacquiring a released demand creates a new observer lease. Its
 * current result is the Query's latest successful data, so it owns that
 * data's rows from reacquisition until its own release. An older acquisition
 * release that publishes later retires only the older lease. If the new
 * lease starts a refetch, a successful refetch replaces the lease's result.
 * A failed refetch keeps the last successful data, so it keeps those rows.
 * `staleTime` decides whether a refetch starts. It cannot decide whether the
 * cached result is owned.
 *
 * Authority: the reacquisition law in the history above, and the TanStack
 * Query rules that a stale Query refetches when an observer mounts and that
 * a failed refetch keeps the previous `data`.
 *
 * Limits: one reacquired on-demand subset whose result has one or two
 * rows, zero to two peer subsets that own the first row, no persisted
 * metadata, and one unrelated optimistic transaction that holds
 * publication. A release commit that
 * rejects and the direct-write path have their own histories below. Eager
 * mode cannot reach the premise: it has no subset release, and ending an
 * eager sync run removes its Query from the cache, so a restart fetches
 * instead of replaying cached data.
 */
const solo: Item = { id: `solo`, category: `detail`, name: `Solo` }

type ReacquisitionHistory = {
  /** `Infinity`: reacquisition starts no fetch. `0`: it starts a refetch. */
  staleTime: number
  /** The refetch outcome. It has no effect when no refetch starts. */
  refetch: `rejects` | `same-rows` | `empty`
  /** The refetch settles before or after the older release publishes. */
  settles: `while-held` | `after-publication`
  /** Peer leases that also own `shared` until after the refetch. */
  peers: 0 | 1 | 2
  /** Rows in the reacquired lease's result; the second is owned only here. */
  rows: 1 | 2
}

type ReacquisitionObservation = {
  /** Public rows after reacquisition, while publication is still held. */
  held: Array<string>
  /** Public rows after the held transactions publish. */
  published: Array<string>
  /** Public rows after the refetch, if any, has settled. */
  settled: Array<string>
  /** Public rows after every peer is released. */
  peerReleased: Array<string>
  /** Public rows after the reacquired demand is released. */
  released: Array<string>
  /** Query function calls. Query staleness decides this count. */
  queryCalls: number
}

/**
 * The model keeps each active lease's latest successful result. Public
 * synced rows are the union of those results at the last publication. Each
 * peer's result is always `shared`; peers are active until `peerReleased`.
 * A peer hides a lost `shared` until the peers leave, which is why that
 * checkpoint exists; the lease-only `solo` row shows a loss at once. While the optimistic blocker
 * holds publication, the public view is the blocker plus the rows published
 * before the release, which the first lease owned. The model does not
 * represent tombstones, ownership maps, or sync transactions.
 */
const modelReacquisition = (
  history: ReacquisitionHistory,
): ReacquisitionObservation => {
  const cached = history.rows === 2 ? [shared.id, solo.id] : [shared.id]
  const refetchStarts = history.staleTime === 0
  const refetched = !refetchStarts
    ? cached
    : history.refetch === `empty`
      ? []
      : // Both a same-rows result and a failed refetch leave the rows owned.
        cached
  const union = (...results: Array<Array<string>>) =>
    [...new Set(results.flat())].sort()
  const peerRows = history.peers > 0 ? [shared.id] : []
  return {
    held: union([`blocker`], cached, peerRows),
    published: union(
      history.settles === `while-held` ? refetched : cached,
      peerRows,
    ),
    settled: union(refetched, peerRows),
    peerReleased: union(refetched),
    released: [],
    queryCalls: 1 + history.peers + (refetchStarts ? 1 : 0),
  }
}

/**
 * The grammar crosses the refetch's start, outcome, and placement relative to
 * the older release's publication. A fresh reacquisition starts no refetch,
 * so it has one history. The `empty` histories reject a design that keeps the
 * row for any reacquired demand. The `rejects` and `same-rows` histories
 * that settle after publication reject a design that skips the cached
 * result because the older lease left an ownership entry behind. Removing
 * the already-applied guard altogether also passes this table; the
 * persisted direct-write histories that keep an accepted write through a
 * refetch start reject that repair. A repair that treats every empty
 * ownership entry as unapplied also passes this table; the sibling history
 * that keeps a direct insert through a refetch start of an empty result
 * rejects it. Each history runs with zero, one, or two peers and with a
 * one- or two-row result. With a peer, the older release keeps `shared`,
 * so only the `peerReleased` checkpoint shows whether the reacquired lease
 * owns it. On the original defect `shared` survives while a peer owns it
 * and disappears when the peers leave, while `solo` disappears at
 * publication. Two peers check that releasing every other owner, not just
 * one, leaves the reacquired lease as the row's owner.
 */
const reacquisitionHistories: Array<ReacquisitionHistory> = (
  [0, 1, 2] as const
).flatMap((peers) =>
  ([1, 2] as const).flatMap((resultRows) => [
    {
      staleTime: Number.POSITIVE_INFINITY,
      refetch: `rejects` as const,
      settles: `after-publication` as const,
      peers,
      rows: resultRows,
    },
    ...([`rejects`, `same-rows`, `empty`] as const).flatMap((refetch) =>
      ([`while-held`, `after-publication`] as const).map((settles) => ({
        staleTime: 0,
        refetch,
        settles,
        peers,
        rows: resultRows,
      })),
    ),
  ]),
)

/**
 * ## Published owners never name a released observer lease
 *
 * Law: each publication records, for each row, the observer leases that own
 * it. A released lease is not an owner, even while its release waits behind
 * held publication. A later lease that claims the row during that wait
 * must not copy the released lease back into the row's owners from metadata
 * that has not yet published the release. A hydrated client trusts those
 * owners: a row stays public there while any recorded owner may still need
 * it, so a stale owner keeps the row alive after its last real owner is
 * released.
 *
 * Authority: the file's opening law (a row remains public while any committed
 * owner needs it), and the hydration history above, which releases a
 * hydrated demand and expects its rows to leave. The reacquisition table
 * above changes how a released lease's ownership entry is read; this table
 * keeps a repair from simply deleting that entry at release.
 *
 * Limits: one row, one released lease `a`, one claiming lease `b`, and an
 * optional peer lease `c` that is never released. `a` may be reacquired
 * without cached data before `b` claims the row; its fetch then fails, so
 * the reacquired lease never applies a result. Hydration uses the public
 * `DbClient.dehydrate` and `hydrate` paths with a fresh QueryClient. Native
 * persistence and cold persisted scans are owned by the persisted histories.
 */
type PublishedOwnerHistory = {
  /** `b` claims the row while `a`'s release is held, or after it publishes. */
  claims: `while-held` | `after-publication`
  /** Whether peer `c` also owns the row and stays acquired. */
  peer: boolean
  /** Whether `a` is reacquired without cached data and its fetch fails. */
  reacquired: boolean
}

type PublishedOwnerObservation = {
  /** Owner edges for the row in the dehydrated state. Keys are opaque. */
  dehydratedOwners: number
  /** Public rows in the hydrated client after it acquires `b`. */
  hydratedLoaded: Array<string>
  /** Public rows in the hydrated client after it releases `b`. */
  hydratedReleased: Array<string>
}

/**
 * The model records the set of active leases whose result holds the row. A
 * release removes its lease at once, regardless of publication. Hydration
 * copies that set; after the hydrated client releases `b`, the row stays
 * exactly when another recorded owner remains. Publication timing is absent
 * from the model, because the law says it cannot change the owner set.
 */
const modelPublishedOwners = (
  history: PublishedOwnerHistory,
): PublishedOwnerObservation => {
  const activeOwners = new Set([`a`, ...(history.peer ? [`c`] : [])])
  activeOwners.delete(`a`)
  activeOwners.add(`b`)
  const afterHydratedRelease = new Set(activeOwners)
  afterHydratedRelease.delete(`b`)
  return {
    dehydratedOwners: activeOwners.size,
    hydratedLoaded: [shared.id],
    hydratedReleased: afterHydratedRelease.size > 0 ? [shared.id] : [],
  }
}

/**
 * `while-held` reaches the premise: `b`'s sync transaction reads row
 * metadata that still names `a`. `after-publication` is the nearby boundary
 * where the release has published first. The peer histories require `c` to
 * remain an owner, so a repair that drops every metadata owner at release,
 * or one that ignores recorded owners on hydration, fails them. A repair that
 * deletes the released lease's ownership entry at release instead of keeping
 * it until publication fails the `while-held` histories. Without a peer, it
 * fails at both the owner count and the leaked hydrated row; with a peer,
 * `c` keeps the row public, so only the owner count distinguishes it.
 *
 * The `reacquired` histories reject a repair that deletes the released
 * entry when the Query is reacquired. The reacquired lease has no result
 * yet, so `b` reads metadata naming `a` while `a` looks unresolved and
 * copies it back. A later result for `a` would correct the edge, so `a`'s
 * fetch fails and it never applies one. The model is unchanged: a lease
 * without a successful result owns nothing.
 */
const publishedOwnerHistories: Array<PublishedOwnerHistory> = (
  [`while-held`, `after-publication`] as const
).flatMap((claims) =>
  [false, true].flatMap((peer) =>
    [false, true].map((reacquired) => ({ claims, peer, reacquired })),
  ),
)

/**
 * An empty persisted baseline is established by its first scan in a sync
 * run. With no durable writer or cache rotation, later retained Query
 * reacquisitions have no row ownership to reconcile and need no further
 * full-store scan.
 * A new sync run has no such evidence: a durable owner may have appeared
 * while this Collection was absent. This is a bounded work proposal beside
 * the existing row-ownership law, not a claim about arbitrary peer writes.
 *
 * The independent model retains only whether the current sync run scanned
 * its empty baseline. `restart` removes that evidence. The fixed histories
 * distinguish retained reacquisition from a cold run. They drive the real
 * Query observer and persistence scan seam. They compare scan counts and
 * public rows after each applied result.
 */
const expectedEmptyBaselineScans = (
  history: ReadonlyArray<`empty-result` | `restart`>,
): number => {
  let scans = 0
  let emptyBaselineKnown = false
  for (const action of history) {
    if (action === `restart`) {
      emptyBaselineKnown = false
    } else if (!emptyBaselineKnown) {
      scans++
      emptyBaselineKnown = true
    }
  }
  return scans
}

/**
 * Law: a direct row keeps its public value and persisted owners through every
 * legal delete, reinsert, refetch, and subset release, as the lifetime reference
 * in the test below states. One call runs one history of that grammar.
 */
async function runDirectRowLifetimeHistory({
  ownerCount,
  withMetadata,
  history,
}: {
  ownerCount: 1 | 2
  withMetadata: boolean
  history:
    | `update`
    | `delete`
    | `delete-insert`
    | `delete-upsert`
    | `delete-insert-refetch`
}): Promise<void> {
  const id = `direct-row-lifetime-${ownerCount}-${withMetadata}-${history}`
  const replacement = { ...shared, name: `Reinserted` }
  const serverReplacement = { ...shared, name: `Server result` }
  const initialResults = Array.from({ length: ownerCount }, () => [shared])
  const laterResults = Array.from({ length: ownerCount }, () => [
    serverReplacement,
  ])
  const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
  const { collection, queryFn } = createOwnershipFixture({
    id,
    results: [...initialResults, ...laterResults],
    metadataRecorder: withMetadata ? metadata : undefined,
  })
  const demands = [categorySubset(`detail`), categorySubset(`list`)].slice(
    0,
    ownerCount,
  )
  const demandHashes = demands.map((demand) =>
    hashKey([id, getLoadSubsetDemandKey(demand)]),
  )
  const claims = new Set<number>()
  let expected: Item | undefined
  let insertedDirectly = false
  const observe = () => {
    expect(collection.get(shared.id)?.name).toBe(expected?.name)
    expect(rows(collection)).toEqual(expected ? [shared.id] : [])
    if (withMetadata)
      expect(
        persistedOwners(collection._state.syncedMetadata, shared.id),
      ).toEqual([...claims].map((index) => demandHashes[index]!).sort())
  }
  for (const [index, demand] of demands.entries()) {
    await collection._sync.loadSubset(demand)
    claims.add(index)
    expected = shared
    insertedDirectly = false
    observe()
  }
  if (history === `update`) {
    await collection.utils.writeUpdate({ id: shared.id, name: `Updated` })
    expected = { ...shared, name: `Updated` }
    observe()
  } else {
    await collection.utils.writeDelete(shared.id)
    expected = undefined
    claims.clear()
    insertedDirectly = false
    observe()
    if (history !== `delete`) {
      if (history === `delete-upsert`)
        await collection.utils.writeUpsert(replacement)
      else await collection.utils.writeInsert(replacement)
      expected = replacement
      insertedDirectly = true
      observe()
    }
  }
  if (history === `delete-insert-refetch`) {
    await collection.utils.refetch()
    demands.forEach((_, index) => claims.add(index))
    expected = serverReplacement
    insertedDirectly = false
    observe()
  }
  for (const [index, demand] of demands.entries()) {
    collection._sync.unloadSubset(demand)
    claims.delete(index)
    if (claims.size === 0 && !insertedDirectly) expected = undefined
    observe()
  }
  expect(queryFn).toHaveBeenCalledTimes(
    ownerCount * (history === `delete-insert-refetch` ? 2 : 1),
  )
}

/**
 * Law: a direct write and a physical fetch are ordered by authored position; the
 * later of the two supplies the shared key. One call runs one order history of
 * the grammar below against the reference it builds.
 */
async function runDirectWriteOrderHistory({
  order,
  laterWrite,
  cacheEdit,
  finalRefetch,
}: {
  order: `write-first` | `fetch-first`
  laterWrite: `none` | `same-key` | `other-key`
  cacheEdit: boolean
  finalRefetch: boolean
}): Promise<void> {
  type Row = { id: string; name: string }
  const queryClient = createQueryClient()
  const queryKey = [`shared-post-write-cached-before-acquisition`]
  let requestNumber = 0
  const queryFn = vi.fn(() =>
    Promise.resolve([
      {
        id: `x`,
        name: ++requestNumber === 1 ? `Server 1` : `Server 2`,
      },
    ]),
  )
  const makeCollection = (id: string) =>
    createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        staleTime: Infinity,
        startSync: true,
      }),
    )
  const a = makeCollection(`cached-newer-a`)
  const b = makeCollection(`cached-newer-b`)
  cleanups.push(async () => {
    await Promise.all([a.cleanup(), b.cleanup()])
    queryClient.clear()
  })
  const reference: {
    position: number
    directX?: { value: string; position: number }
    remoteX?: { value: string; position: number }
    cacheStillFetched: boolean
  } = { position: 0, cacheStillFetched: false }
  const writeX = async (name: string) => {
    reference.directX = { value: name, position: ++reference.position }
    if (a.has(`x`)) await a.utils.writeUpdate({ id: `x`, name })
    else await a.utils.writeInsert({ id: `x`, name })
  }
  const fetchB = async (first: boolean) => {
    const started = ++reference.position
    if (first) await b._sync.loadSubset({})
    else await b.utils.refetch({ throwOnError: true })
    reference.remoteX = {
      value: first ? `Server 1` : `Server 2`,
      position: started,
    }
    reference.cacheStillFetched = true
  }
  if (order === `write-first`) await writeX(`Written`)
  await fetchB(true)
  if (order === `fetch-first`) await writeX(`Written`)
  if (laterWrite === `same-key`) await writeX(`Later write`)
  if (laterWrite === `other-key`) {
    reference.position++
    await a.utils.writeInsert({ id: `y`, name: `Other write` })
  }
  if (cacheEdit) {
    queryClient.setQueryData(queryKey, [{ id: `x`, name: `Local cache edit` }])
    reference.cacheStillFetched = false
  }
  if (finalRefetch) await fetchB(false)
  const callsBeforeAcquisition = queryFn.mock.calls.length
  await a._sync.loadSubset({})
  const revalidatedCacheEdit = cacheEdit && !finalRefetch
  expect(queryFn).toHaveBeenCalledTimes(
    callsBeforeAcquisition + Number(revalidatedCacheEdit),
  )
  if (revalidatedCacheEdit) {
    reference.remoteX = {
      value: `Server 2`,
      position: ++reference.position,
    }
    reference.cacheStillFetched = true
  }
  const { directX, remoteX, cacheStillFetched } = reference
  if (!directX || !remoteX) throw new Error(`Illegal authority history`)
  const remoteMayReplace =
    cacheStillFetched && remoteX.position > directX.position
  expect(a.get(`x`)?.name).toBe(
    remoteMayReplace ? remoteX.value : directX.value,
  )
  // The complete unbounded response omits y, so it retires that
  // ownerless direct row; without such a response the row survives.
  expect(a.get(`y`)?.name).toBe(
    laterWrite === `other-key` && !finalRefetch && !revalidatedCacheEdit
      ? `Other write`
      : undefined,
  )
  a._sync.unloadSubset({})
  expect(a.get(`x`)?.name).toBe(remoteMayReplace ? undefined : directX.value)
}

/**
 * Law: a physical fetch takes its position when it starts, so the newest started
 * fetch supplies a shared row, and releasing a newer owner does not revert it. One
 * call runs one history of the grammar below and compares public values.
 */
async function runOverlappingSubsetHistory({
  existingOwner,
  settleNewerFirst,
  directWrite,
  sameValue,
}: {
  existingOwner: boolean
  settleNewerFirst: boolean
  directWrite: `none` | `between` | `after`
  sameValue: boolean
}): Promise<void> {
  const id = `overlapping-fetch-value-${existingOwner}-${settleNewerFirst}-${directWrite}-${sameValue}`
  const older = createDeferred<Array<Item>>()
  const newer = createDeferred<Array<Item>>()
  const initial = { ...shared, name: `Initial` }
  const olderRow = { ...shared, name: `Older` }
  const newerRow = { ...shared, name: sameValue ? `Initial` : `Newer` }
  const manual = { ...shared, name: `Manual` }
  const { collection, queryClient, queryFn } = createOwnershipFixture({
    id,
    results: existingOwner
      ? [[initial], older.promise, newer.promise]
      : [older.promise, newer.promise],
  })
  cleanups.push(async () => {
    older.resolve([olderRow])
    newer.resolve([newerRow])
  })
  const olderSubset = { where: eq(new IR.PropRef([`category`]), `shared`) }
  const newerSubset = { where: eq(new IR.PropRef([`id`]), `shared`) }
  expect(getLoadSubsetDemandKey(olderSubset)).not.toBe(
    getLoadSubsetDemandKey(newerSubset),
  )
  // The provider's authored rows must be legal for their real scopes.
  // This checks fixture admission only; the reference below still judges
  // public values independently of the production expression compiler.
  expect(
    toBooleanPredicate(compileSingleRowExpression(olderSubset.where)(initial)),
  ).toBe(true)
  expect(
    toBooleanPredicate(compileSingleRowExpression(olderSubset.where)(olderRow)),
  ).toBe(true)
  expect(
    toBooleanPredicate(compileSingleRowExpression(newerSubset.where)(newerRow)),
  ).toBe(true)

  // Model: each accepted operation may replace the value only when its
  // position exceeds the position of the accepted value already held.
  // Claiming a subset and replacing a value are separate operations.
  const reference: {
    position: number
    acceptedAt: number
    value: string | undefined
    owners: Set<`older` | `newer`>
  } = {
    position: 0,
    acceptedAt: 0,
    value: undefined,
    owners: new Set(),
  }
  const start = () => ++reference.position
  const acceptFetch = (
    owner: `older` | `newer`,
    started: number,
    value: string,
  ) => {
    reference.owners.add(owner)
    if (started > reference.acceptedAt) {
      reference.value = value
      reference.acceptedAt = started
    }
  }
  const acceptWrite = () => {
    reference.value = manual.name
    reference.acceptedAt = ++reference.position
  }
  const expectPublicRow = () => {
    expect(collection.get(shared.id)?.name).toBe(
      reference.owners.size > 0 ? reference.value : undefined,
    )
    expect(collection.has(shared.id)).toBe(reference.owners.size > 0)
  }

  if (existingOwner) {
    const initialStart = start()
    await collection._sync.loadSubset(olderSubset)
    acceptFetch(`older`, initialStart, initial.name)
    expectPublicRow()
  }
  const olderStart = start()
  const olderLoad = collection._sync.loadSubset(
    existingOwner ? { ...olderSubset, refetch: true } : olderSubset,
  )
  void Promise.resolve(olderLoad).catch(() => undefined)
  await vi.waitFor(() =>
    expect(queryFn).toHaveBeenCalledTimes(existingOwner ? 2 : 1),
  )

  if (directWrite === `between`) {
    await collection.utils.writeUpdate(manual)
    acceptWrite()
    expectPublicRow()
  }
  const newerStart = start()
  const newerLoad = collection._sync.loadSubset(newerSubset)
  void Promise.resolve(newerLoad).catch(() => undefined)
  await vi.waitFor(() =>
    expect(queryFn).toHaveBeenCalledTimes(existingOwner ? 3 : 2),
  )
  expect(queryClient.getQueryCache().findAll({ queryKey: [id] })).toHaveLength(
    2,
  )
  if (directWrite === `after`) {
    await collection.utils.writeUpdate(manual)
    acceptWrite()
    expectPublicRow()
  }

  const settle = async (owner: `older` | `newer`) => {
    if (owner === `older`) {
      older.resolve([olderRow])
      await olderLoad
      acceptFetch(owner, olderStart, olderRow.name)
    } else {
      newer.resolve([newerRow])
      await newerLoad
      acceptFetch(owner, newerStart, newerRow.name)
    }
    expectPublicRow()
  }
  if (settleNewerFirst) {
    await settle(`newer`)
    await settle(`older`)
  } else {
    await settle(`older`)
    await settle(`newer`)
  }

  const release = (owner: `older` | `newer`) => {
    const subset = owner === `older` ? olderSubset : newerSubset
    collection._sync.unloadSubset(subset)
    if (owner === `older` && existingOwner)
      collection._sync.unloadSubset(subset)
    reference.owners.delete(owner)
    expectPublicRow()
  }
  if (existingOwner) {
    release(`older`)
    release(`newer`)
  } else {
    release(`newer`)
    release(`older`)
  }

  // Reacquisition starts a new row-ownership lifetime. Only the acquired
  // Query's retained cache is projected; an earlier overlap does not
  // permanently rewrite a different Query entry. This legal neighbor
  // distinguishes continuous-owner precedence from global precedence.
  if (!existingOwner && settleNewerFirst && directWrite === `none`) {
    reference.owners.add(`older`)
    reference.value = olderRow.name
    await collection._sync.loadSubset(olderSubset)
    expectPublicRow()
    expect(queryFn).toHaveBeenCalledTimes(2)
    collection._sync.unloadSubset(olderSubset)
    reference.owners.delete(`older`)
    expectPublicRow()

    reference.owners.add(`newer`)
    reference.value = newerRow.name
    await collection._sync.loadSubset(newerSubset)
    expectPublicRow()
    expect(queryFn).toHaveBeenCalledTimes(2)
  }
}

/**
 * Law: a fetch that started before a direct write keeps the server's rows for
 * every key that write did not touch; a write recorded after the fetch began
 * wins for its key. This reference overlays the writes on the fetched rows in
 * order. It is the expected visible rows of the merge-cut histories below.
 */
type MergeRow = { id: string; value: string }
function mergeDirectWritesOverFetch(
  fetched: Array<MergeRow>,
  writes: Array<MergeRow>,
): Record<string, string> {
  const rows = new Map(fetched.map((row) => [row.id, row]))
  for (const row of writes) rows.set(row.id, row)
  return Object.fromEntries(
    [...rows.values()].map((row) => [row.id, row.value]),
  )
}

declareOracle({
  check: [
    expectPublicRefetchObservation,
    runDirectRowLifetimeHistory,
    runDirectWriteOrderHistory,
    runOverlappingSubsetHistory,
  ],
  model: [
    advanceResultSettlementModel,
    reduceExplicitRefetchApplication,
    reduceRefetchCallSettlement,
    reduceHandlerRefetchBoundary,
    reduceMutationRefreshLiveness,
    observeHandlerRefetchBoundary,
    observeQueryCacheWork,
    observeFetchRecordSuccessorWork,
    modelReacquisition,
    modelPublishedOwners,
    expectedEmptyBaselineScans,
    mergeDirectWritesOverFetch,
  ],
  grammar: [mutationRefreshHistoryGrammar, handlerCollectionHistoryGrammar],
})

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
    const detail = { where: eq(new IR.PropRef([`category`]), `detail`) }
    const list = { where: eq(new IR.PropRef([`category`]), `list`) }
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

  it(`settles an eager refetch at fetch while another collection refetches`, async () => {
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
    void onDemand.utils.refetch({ throwOnError: true }).catch(() => {})
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

  it.each([`fulfilled`, `rejected`] as const)(
    `keeps a same-result reentrant $receiptOutcome receipt attached to its refetch`,
    async (receiptOutcome) => {
      const id = `same-result-reentrant-application`
      const initial = { ...shared, name: `Initial` }
      const updated = { ...shared, name: `Updated` }
      const applicationFailure = new Error(`Reentrant application failed`)
      const reentrantApplication = createDeferred<void>()
      const reentrantApplicationStarted = createDeferred<void>()
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([initial])
        .mockResolvedValueOnce([updated])
      const baseOptions = queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
      })
      const originalSync = baseOptions.sync
      let commitDepth = 0
      let holdReentrantApplication = false
      let reentrantCommitCount = 0
      const collection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              commit: (signal) => {
                commitDepth++
                try {
                  const applied = params.commit(signal)
                  if (holdReentrantApplication && commitDepth > 1) {
                    reentrantCommitCount++
                    reentrantApplicationStarted.resolve(undefined)
                    return Promise.resolve(
                      applied === true ? undefined : applied,
                    ).then(() => reentrantApplication.promise)
                  }
                  return applied
                } finally {
                  commitDepth--
                }
              },
            }),
        },
      })
      const consoleError =
        receiptOutcome === `rejected`
          ? vi.spyOn(console, `error`).mockImplementation(() => {})
          : undefined
      let subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      cleanups.push(async () => {
        consoleError?.mockRestore()
        reentrantApplication.resolve(undefined)
        subscription.unsubscribe()
        await collection.cleanup()
        queryClient.clear()
      })

      await collection.stateWhenReady()
      let reentered = false
      const publications: Array<
        Array<{ type: string; name: string; previousName?: string }>
      > = []
      subscription.unsubscribe()
      subscription = collection.subscribeChanges(
        (batch) => {
          if (batch.length > 0) {
            publications.push(
              batch.map((change) => ({
                type: change.type,
                name: change.value.name,
                ...(change.type === `update`
                  ? { previousName: change.previousValue?.name }
                  : {}),
              })),
            )
          }
          if (reentered || collection.get(shared.id)?.name !== updated.name)
            return
          reentered = true
          // Dropping the last subscriber and immediately adding another makes
          // Query DB apply this observer's exact current result again while the
          // outer synchronous commit is still delivering its change.
          subscription.unsubscribe()
          subscription = collection.subscribeChanges(() => {}, {
            includeInitialState: false,
          })
        },
        { includeInitialState: false },
      )
      holdReentrantApplication = true
      let model = createRefetchCallSettlementModel([`query`], true)
      model = reduceRefetchCallSettlement(model, {
        type: `accept-application`,
        queryId: `query`,
        applicationId: `reentrant-application`,
      })
      model = reduceRefetchCallSettlement(model, {
        type: `settle-fetch`,
        queryId: `query`,
        outcome: `fulfilled`,
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
      void refetch.catch(() => undefined)

      await reentrantApplicationStarted.promise
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      expect(reentered).toBe(true)
      expect(reentrantCommitCount).toBe(1)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(refetchOutcome).toBe(observeRefetchCallSettlement(model).refetch)
      expect(publications).toEqual([
        [{ type: `update`, name: `Updated`, previousName: `Initial` }],
      ])

      if (receiptOutcome === `fulfilled`) {
        reentrantApplication.resolve(undefined)
        await expect(refetch).resolves.toHaveLength(1)
      } else {
        reentrantApplication.reject(applicationFailure)
        await expect(refetch).rejects.toBe(applicationFailure)
      }
      model = reduceRefetchCallSettlement(model, {
        type: `settle-application`,
        applicationId: `reentrant-application`,
        outcome: receiptOutcome,
      })
      expect(refetchOutcome).toBe(observeRefetchCallSettlement(model).refetch)
      expect(collection.get(shared.id)?.name).toBe(updated.name)
      expect(publications).toEqual([
        [{ type: `update`, name: `Updated`, previousName: `Initial` }],
      ])
    },
  )

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

  it(`does not reuse an eager initial rejection when clearError applies a valid result`, async () => {
    const id = `eager-recovered-result-settlement`
    const invalidResult = 42 as unknown as Array<Item>
    const recovered = { ...shared, name: `Recovered` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce(invalidResult)
      .mockResolvedValueOnce([recovered])
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
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
    cleanups.push(async () => {
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    let expected = startResultSettlementModel(`invalid`)
    await expect(collection.stateWhenReady()).rejects.toBeInstanceOf(
      InvalidQueryResultError,
    )
    expected = advanceResultSettlementModel(expected, {
      type: `query-succeeded`,
      operation: `invalid`,
      result: `invalid-shape`,
    })
    expect(collection.status).toBe(`error`)
    expect(collection.utils.errorCount).toBe(1)

    expected = advanceResultSettlementModel(expected, {
      type: `start-refetch`,
      operation: `recovered`,
    })
    let rejection: unknown
    const recovery = collection.utils.clearError().then(
      () => ({
        settled: true,
        outcome: `fulfilled` as const,
        rowCount: collection.size,
      }),
      (error: unknown) => {
        rejection = error
        return { settled: true, outcome: `rejected` as const }
      },
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    expected = advanceResultSettlementModel(expected, {
      type: `query-succeeded`,
      operation: `recovered`,
      result: `applicable`,
      rowCount: 1,
    })

    expectPublicRefetchObservation(expected, `recovered`, await recovery)
    expect(rejection).toBeUndefined()
    expect(collection.status).toBe(`ready`)
    expect(collection.utils.lastError).toBeUndefined()
    expect(collection.utils.errorCount).toBe(0)
    expect(collection.get(shared.id)?.name).toBe(recovered.name)
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

  /**
   * The driver uses the public `loadSubset` and `unloadSubset` entry points, a
   * real QueryClient, and a held query function for the refetch. The blocker's
   * mutation function holds publication. Each checkpoint follows a settled
   * macrotask turn, so the comparison reads rows only after the step's sync
   * work has run. `loadSubset` settlement is not compared: this law does not
   * say whether the caller waits for the refetch.
   */
  it.each(reacquisitionHistories)(
    `keeps a reacquired lease's result (staleTime $staleTime, refetch $refetch, settles $settles, peers $peers, rows $rows)`,
    async (history) => {
      const id = `reacquired-lease-${history.staleTime}-${history.refetch}-${history.settles}-${history.peers}-${history.rows}`
      const detail = categorySubset(`detail`)
      const peerSubsets = [
        categorySubset(`list`),
        {
          where: new IR.Func(`in`, [
            new IR.PropRef([`category`]),
            new IR.Value([`peer`, `shared`]),
          ]),
        },
      ].slice(0, history.peers)
      const leaseResult = history.rows === 2 ? [shared, solo] : [shared]
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const refetch = createDeferred<Array<Item>>()
      void refetch.promise.catch(() => undefined)
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [leaseResult, ...peerSubsets.map(() => [shared])],
        staleTime: history.staleTime,
      })
      queryFn.mockImplementationOnce(() => refetch.promise)
      const settleRefetch = () => {
        if (history.refetch === `rejects`)
          refetch.reject(new Error(`refetch failed`))
        else
          refetch.resolve(
            history.refetch === `empty`
              ? []
              : leaseResult.map((item) => ({ ...item })),
          )
      }
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })

      await collection._sync.loadSubset(detail)
      for (const peer of peerSubsets) await collection._sync.loadSubset(peer)
      mutation.mutate(() => collection.insert(blocker))
      cleanups.push(async () => {
        persistence.resolve()
        refetch.reject(new Error(`cleanup`))
        await mutation.isPersisted.promise.catch(() => undefined)
      })

      // The release's sync transaction is accepted but held behind the blocker.
      const pendingBefore = collection._state.pendingSyncedTransactions.length
      collection._sync.unloadSubset(detail)
      await vi.waitFor(() =>
        expect(
          collection._state.pendingSyncedTransactions.length,
        ).toBeGreaterThan(pendingBefore),
      )
      const reacquired = Promise.resolve(collection._sync.loadSubset(detail))
      void reacquired.catch(() => undefined)
      await settleTurn()
      const held = rows(collection)

      if (history.settles === `while-held`) {
        settleRefetch()
        await settleTurn()
      }
      persistence.resolve()
      await mutation.isPersisted.promise
      await settleTurn()
      const published = rows(collection)

      if (history.settles === `after-publication`) {
        settleRefetch()
        await settleTurn()
      }
      await reacquired.catch(() => undefined)
      const settled = rows(collection)

      for (const peer of peerSubsets) {
        collection._sync.unloadSubset(peer)
        await settleTurn()
      }
      const peerReleased = rows(collection)

      collection._sync.unloadSubset(detail)
      await settleTurn()

      expect({
        held,
        published,
        settled,
        peerReleased,
        released: rows(collection),
        queryCalls: queryFn.mock.calls.length,
      }).toEqual(modelReacquisition(history))
    },
  )

  /**
   * The driver runs a server DbClient and a hydrated browser DbClient over the
   * same Collection descriptor. On the server, an optimistic blocker holds
   * publication while `a` is released and, in `while-held` histories, while
   * `b` is acquired. In `reacquired` histories, `a`'s Query is removed with
   * the public `QueryClient.removeQueries` after its release, then `a` is
   * reacquired and its held fetch rejects after `b` claims the row. The
   * checkpoints are the dehydrated state after every held
   * transaction publishes, and the hydrated client's public rows after it
   * acquires and then releases `b`.
   */
  it.each(publishedOwnerHistories)(
    `publishes only active owners when a lease claims a released row (claims $claims, peer $peer, reacquired $reacquired)`,
    async (history) => {
      const id = `published-owners-${history.claims}-${history.peer}-${history.reacquired}`
      const subset = (category: string): LoadSubsetOptions => ({
        where: new IR.Func(`in`, [
          new IR.PropRef([`category`]),
          new IR.Value([category, `shared`]),
        ]),
      })
      const [a, b, c] = [subset(`a`), subset(`b`), subset(`c`)]
      // Query keys embed the subset as JSON, so `a`'s key holds `\"a\"`.
      const isQueryForA = (queryKey: unknown) =>
        JSON.stringify(queryKey).includes(`\\"a\\"`)
      const reacquiredFetch = createDeferred<Array<Item>>()
      void reacquiredFetch.promise.catch(() => undefined)
      const createClient = (
        queryFn: (context: QueryFunctionContext) => Promise<Array<Item>> = () =>
          Promise.resolve([shared]),
      ) => {
        const queryClient = createQueryClient()
        const descriptor = collectionOptions(
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
        const client = new DbClient({ queryClient })
        cleanups.push(async () => {
          await client.cleanup()
          queryClient.clear()
        })
        return {
          client,
          queryClient,
          collection: client.collection(descriptor),
        }
      }
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      let fetchesForA = 0
      const server = createClient(({ queryKey }) => {
        if (isQueryForA(queryKey) && fetchesForA++ > 0)
          return reacquiredFetch.promise
        return Promise.resolve([shared])
      })
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      cleanups.push(async () => {
        persistence.resolve()
        reacquiredFetch.reject(new Error(`cleanup`))
        await mutation.isPersisted.promise.catch(() => undefined)
      })

      await server.collection._sync.loadSubset(a)
      if (history.peer) await server.collection._sync.loadSubset(c)
      mutation.mutate(() => server.collection.insert(blocker))
      server.collection._sync.unloadSubset(a)
      let reacquired: Promise<unknown> | undefined
      if (history.reacquired) {
        await settleTurn()
        server.queryClient.removeQueries({
          predicate: (query) => isQueryForA(query.queryKey),
        })
        reacquired = Promise.resolve(server.collection._sync.loadSubset(a))
        void reacquired.catch(() => undefined)
        await settleTurn()
      }
      const failReacquiredFetch = async () => {
        const pending = reacquired
        if (!pending) return
        reacquiredFetch.reject(new Error(`reacquired fetch failed`))
        await pending.catch(() => undefined)
        await settleTurn()
      }
      if (history.claims === `while-held`) {
        const claimed = Promise.resolve(server.collection._sync.loadSubset(b))
        await settleTurn()
        await failReacquiredFetch()
        persistence.resolve()
        await mutation.isPersisted.promise
        await claimed
      } else {
        persistence.resolve()
        await mutation.isPersisted.promise
        await settleTurn()
        await server.collection._sync.loadSubset(b)
        await failReacquiredFetch()
      }
      await settleTurn()
      const state = server.client.dehydrate({
        shouldDehydrateCollection: () => true,
      })
      const sharedRow = state.collections
        .flatMap((chunk) => chunk.rows)
        .find((row) => row.key === shared.id)
      const owners = (
        sharedRow?.metadata as
          { queryCollection?: { owners?: Record<string, true> } } | undefined
      )?.queryCollection?.owners

      const browser = createClient()
      browser.client.hydrate(state)
      await browser.collection._sync.loadSubset(b)
      const hydratedLoaded = rows(browser.collection)
      browser.collection._sync.unloadSubset(b)
      await settleTurn()

      expect({
        dehydratedOwners: Object.keys(owners ?? {}).length,
        hydratedLoaded,
        hydratedReleased: rows(browser.collection),
      }).toEqual(modelPublishedOwners(history))
    },
  )

  // Law: a fetch that started before a direct write keeps the server's rows
  // for every key that write did not touch; a key written after the fetch
  // began keeps its accepted row. Reference: the fetched rows, overlaid by the
  // direct writes made after the fetch started, in order. Checkpoint: visible
  // rows and the Query cache after the fetch settles. Cuts: the initial load,
  // a handler's automatic refetch while another handler writes a different
  // key or the same key, and a user refetch. The review probes are these cuts.
  type MergeCut =
    | `initial-load`
    | `handler-refetch-other-key`
    | `handler-refetch-same-key`
    | `user-refetch`
  it.each<MergeCut>([
    `initial-load`,
    `handler-refetch-other-key`,
    `handler-refetch-same-key`,
    `user-refetch`,
  ])(
    `keeps server rows a direct write did not touch when an older fetch settles: %s`,
    async (cut) => {
      type Row = { id: string; value: string }
      const id = `older-fetch-merge-${cut}`
      let server: Array<Row> =
        cut === `initial-load`
          ? [
              { id: `1`, value: `a` },
              { id: `2`, value: `b` },
            ]
          : [
              { id: `1`, value: `old1` },
              { id: `2`, value: `old2` },
            ]
      const held: Array<ReturnType<typeof createDeferred<void>>> = []
      let hold = cut === `initial-load`
      const queryClient = createQueryClient()
      const writtenKey = cut === `handler-refetch-same-key` ? `1` : `2`
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: async () => {
            const snapshot = server.map((row) => ({ ...row }))
            if (hold) {
              const gate = createDeferred<void>()
              held.push(gate)
              await gate.promise
            }
            return snapshot
          },
          getKey: (row) => row.id,
          startSync: true,
          onUpdate: async ({ transaction, collection: handlerCollection }) => {
            const modified = transaction.mutations[0].modified
            if (modified.value === `A`) {
              // Handler A: the server accepts the change, and the automatic
              // refetch confirms it.
              server = server.map((row) =>
                row.id === `1` ? { id: `1`, value: `A` } : row,
              )
              return
            }
            server = server.map((row) =>
              row.id === writtenKey ? { id: writtenKey, value: `B` } : row,
            )
            await handlerCollection.utils.writeUpdate({
              id: writtenKey,
              value: `B`,
            })
            return { refetch: false }
          },
        }),
      )
      cleanups.push(async () => {
        held.forEach((gate) => gate.resolve())
        await collection.cleanup()
        queryClient.clear()
      })
      const visible = () =>
        Object.fromEntries(
          Array.from(collection.values(), (row) => [row.id, row.value]),
        )
      const cached = () =>
        Object.fromEntries(
          (queryClient.getQueryData<Array<Row>>([id]) ?? []).map((row) => [
            row.id,
            row.value,
          ]),
        )

      let expected: Record<string, string>
      if (cut === `initial-load`) {
        const fetched = server
        const ready = collection.preload()
        await vi.waitFor(() => expect(held).toHaveLength(1))
        await collection.utils.writeInsert({ id: `3`, value: `c` })
        expect(
          queryClient.getQueryCache().find({ queryKey: [id] })?.state.status,
        ).toBe(`pending`)
        held[0]!.resolve()
        await ready
        expected = mergeDirectWritesOverFetch(fetched, [
          { id: `3`, value: `c` },
        ])
      } else if (cut === `user-refetch`) {
        await collection.preload()
        server = [
          { id: `1`, value: `new1` },
          { id: `2`, value: `new2` },
        ]
        const fetched = server
        hold = true
        const refetch = collection.utils.refetch()
        await vi.waitFor(() => expect(held).toHaveLength(1))
        hold = false
        await collection.utils.writeInsert({ id: `3`, value: `c` })
        held[0]!.resolve()
        await refetch
        expected = mergeDirectWritesOverFetch(fetched, [
          { id: `3`, value: `c` },
        ])
        // The refetch settles only once the merged rows are visible.
        expect(visible()).toEqual(expected)
      } else {
        await collection.preload()
        hold = true
        const first = collection.update(`1`, (draft) => {
          draft.value = `A`
        })
        await vi.waitFor(() => expect(held).toHaveLength(1))
        hold = false
        const fetched = server
        await collection.update(writtenKey, (draft) => {
          draft.value = `B-optimistic`
        }).isPersisted.promise
        held[0]!.resolve()
        await first.isPersisted.promise
        expected = mergeDirectWritesOverFetch(fetched, [
          { id: writtenKey, value: `B` },
        ])
      }
      await vi.waitFor(() => expect(visible()).toEqual(expected))
      expect(cached()).toEqual(expected)
    },
  )

  /**
   * A fetched row lifetime has one or more subset claims. A direct update
   * preserves them; a direct delete ends that lifetime and all its claims.
   * Inserting or upserting the same key after the delete creates an unowned
   * lifetime. A later provider result can claim it again. The reference below
   * uses only these row-lifetime rules, not Query cache or ownership helpers.
   *
   * The bounded legal grammar crosses one/two overlapping subset owners,
   * in-memory/persisted metadata, and update, delete, reinsert, upsert, and
   * refetch-after-reinsert. The driver uses real QueryClient and public write
   * utilities. The independent claim set records demand indices, then maps
   * those indices to the documented static on-demand Query key for metadata
   * comparison. It compares public rows and exact accepted owner identities
   * after each action and release; forgetting ownership on any write fails the
   * update lane, while retaining a deleted lifetime fails the reinsert lane.
   */
  it.each(
    ([1, 2] as const).flatMap((ownerCount) =>
      ([false, true] as const).flatMap((withMetadata) =>
        (
          [
            `update`,
            `delete`,
            `delete-insert`,
            `delete-upsert`,
            `delete-insert-refetch`,
          ] as const
        ).map((history) => ({ ownerCount, withMetadata, history })),
      ),
    ),
  )(
    `tracks a direct row lifetime through $history with $ownerCount owners and metadata=$withMetadata`,
    runDirectRowLifetimeHistory,
  )

  /**
   * A's accepted direct row has its own position. A physical fetch started
   * later may replace and claim it when A next acquires the shared Query;
   * an earlier fetched snapshot or B's local cache edit may not. The small
   * reference below orders only authored writes and actual provider fetches.
   * Cache edits invalidate the last fetched snapshot but do not create a new
   * remote position. It deliberately has no Query observers or cache-version
   * classifier.
   *
   * The legal grammar crosses fetch/write order, another write to the same or
   * a disjoint key, a foreign local cache edit, and a final real refetch. The
   * driver uses two Collections sharing one physical Query. At A's acquisition
   * and subset release it compares public rows with the reference. A fetched
   * cached result needs no request; a local cache edit with no later fetch
   * requires one to establish authority. The inverse order rejects blindly
   * trusting any cached result; the cache-edit lanes reject mistaking
   * setQueryData for a remote success.
   */
  it.each(
    ([`write-first`, `fetch-first`] as const).flatMap((order) =>
      ([`none`, `same-key`, `other-key`] as const).flatMap((laterWrite) =>
        ([false, true] as const).flatMap((cacheEdit) =>
          ([false, true] as const).map((finalRefetch) => ({
            order,
            laterWrite,
            cacheEdit,
            finalRefetch,
          })),
        ),
      ),
    ),
  )(
    `orders shared fetches, writes, and cache edits before acquisition: $order/$laterWrite/cache=$cacheEdit/refetch=$finalRefetch`,
    runDirectWriteOrderHistory,
  )

  /**
   * Two distinct on-demand Queries can return the same row. For that row, a
   * successfully applied physical fetch takes its position when it starts:
   * the latest such fetch supplies the value, even when an older fetch settles
   * afterward. An older result still claims its own subset, so releasing the
   * newer subset does not discard the row or revert its value. An accepted
   * direct write participates in the same order for the key it changes.
   *
   * The reference below has only one row, its last accepted position, and a
   * set of subset owners. It does not classify Query cache events or replay
   * production's ownership maps. The legal histories cross an existing versus
   * first-time older owner and both settlement orders; two neighboring writes
   * fall between or after the fetch starts. The driver uses distinct semantic
   * demands and real Query observers. One newer result repeats the initial
   * value: it still takes a position that an older result cannot undo. After
   * each applied settlement and after releasing the newer owner, the public
   * Collection row must match the model.
   */
  it.each([
    ...([false, true] as const).flatMap((existingOwner) =>
      ([false, true] as const).map((settleNewerFirst) => ({
        existingOwner,
        settleNewerFirst,
        directWrite: `none` as const,
        sameValue: false,
      })),
    ),
    {
      existingOwner: true,
      settleNewerFirst: true,
      directWrite: `none` as const,
      sameValue: true,
    },
    {
      existingOwner: true,
      settleNewerFirst: true,
      directWrite: `between` as const,
      sameValue: false,
    },
    {
      existingOwner: true,
      settleNewerFirst: true,
      directWrite: `after` as const,
      sameValue: false,
    },
  ])(
    `orders overlapping subset values and owners: existing=$existingOwner/newer-first=$settleNewerFirst/write=$directWrite/equal=$sameValue`,
    runOverlappingSubsetHistory,
  )

  it(`does not rescan a stable empty persisted baseline on retained reacquisition`, async () => {
    const id = `empty-persisted-baseline-work`
    const queryHash = hashKey([id])
    const scanPersistedRows = vi.fn(() => Promise.resolve([]))
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[], [], []],
      scanPersistedRows,
      persistedGcTime: Number.POSITIVE_INFINITY,
      setupMetadata: (metadata) =>
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        }),
    })
    const history: Array<`empty-result` | `restart`> = []

    await collection._sync.loadSubset({})
    history.push(`empty-result`)
    expect(rows(collection)).toEqual([])
    expect(scanPersistedRows).toHaveBeenCalledTimes(
      expectedEmptyBaselineScans(history),
    )

    for (let result = 0; result < 2; result++) {
      collection._sync.unloadSubset({})
      await collection._sync.loadSubset({ refetch: true })
      history.push(`empty-result`)
      expect(rows(collection)).toEqual([])
      expect(scanPersistedRows).toHaveBeenCalledTimes(
        expectedEmptyBaselineScans(history),
      )
    }
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it(`scans a cold durable owner that appeared after an empty sync run`, async () => {
    const id = `cold-owner-after-empty-baseline`
    const queryHash = hashKey([id])
    const hotStorage = createOwnershipStorage()
    const hot = createPersistedOwnershipFixture(id, hotStorage, [])
    await hot.collection._sync.loadSubset({})
    expect(storedItems(hotStorage)).toEqual([])
    await hot.collection.cleanup()

    // This seeded durable state represents another writer's committed owner
    // while the first Collection had no sync run. The cold Collection cannot
    // use the first run's empty-baseline evidence.
    const coldSeed = hotStorage.snapshot()
    coldSeed.rows.set(shared.id, shared)
    coldSeed.rowMetadata.set(shared.id, {
      queryCollection: { owners: { [queryHash]: true } },
    })
    coldSeed.collectionMetadata.set(`queryCollection:gc:${queryHash}`, {
      queryHash,
      mode: `until-revalidated`,
    })
    const coldStorage = createOwnershipStorage(coldSeed)
    const coldScanRows = vi.spyOn(coldStorage.adapter, `scanRows`)
    const cold = createPersistedOwnershipFixture(id, coldStorage, [])
    await cold.collection._sync.loadSubset({})

    // The empty provider result retires the cold durable owner. A design that
    // skips every empty-baseline scan leaves the stored row behind.
    expect(cold.queryFn).toHaveBeenCalledOnce()
    expect(rows(cold.collection)).toEqual([])
    expect(storedItems(coldStorage)).toEqual([])
    expect(coldScanRows).toHaveBeenCalledTimes(
      expectedEmptyBaselineScans([`restart`, `empty-result`]),
    )
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
})
