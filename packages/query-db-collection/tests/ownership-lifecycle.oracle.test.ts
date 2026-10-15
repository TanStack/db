import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CancelledError,
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
  dehydrate,
  focusManager,
  hashKey,
  hydrate,
  isCancelledError,
  onlineManager,
} from '@tanstack/query-core'
import {
  BasicIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  createTransaction,
  eq,
  getLegacyLoadSubsetDemandKey,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import {
  compileSingleRowExpression,
  toBooleanPredicate,
} from '../../db/src/query/compiler/evaluators.js'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src/index.js'
import { createNodeSQLitePersistence } from '../../node-db-sqlite-persistence/src/index.js'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver.js'
import {
  InvalidQueryResultError,
  SyncNotInitializedError,
} from '../src/errors.js'
import { queryCollectionOptions } from '../src/query.js'
import type {
  Collection,
  LoadSubsetOptions,
  SyncMetadataApi,
  SyncPersistenceScanOptions,
  Transaction,
} from '@tanstack/db'
import type { QueryFunctionContext } from '@tanstack/query-core'
import type {
  PersistedCacheGenerationClaim,
  PersistenceAdapter,
} from '../../db-sqlite-persistence-core/src/index.js'
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
 * An accepted direct write changes its Collection without starting a Query
 * request. In eager mode, compatible Collections sharing a physical Query
 * project representable cache patches made by either writer. In on-demand
 * mode, a direct write leaves a Query owned by another Collection untouched;
 * a later peer cannot publish another writer's patched cache as a server
 * result. A later physical fetch may replace the direct row, while a disabled
 * on-demand peer waits for explicit refetch. The shared-cache rules cover one
 * QueryClient. A separate cold history below requires physical revalidation
 * when hydration into another client loses local-patch provenance.
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
  persistedGcTime?: number
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

// The overlap fixtures return rows from both named categories.
// A literal field name passed to eq() would instead become a constant value.
const categoryIn = (...categories: Array<string>) =>
  new IR.Func(`in`, [new IR.PropRef([`category`]), new IR.Value(categories)])
const cleanups: Array<() => Promise<void>> = []
let proxyFixtureSequence = 0

/**
 * Collection.createIndex supplies a single-row proxy from the same DB package
 * instance that Query Collection uses to encode its demand. The index is only
 * a public route to that fixture; no index behavior is under test here.
 */
function literalProxy(path: `category` | `other` | `value`): unknown {
  type ProxyRow = {
    id: string
    category: string
    other: string
    value: number
  }
  const collection = createCollection<ProxyRow>({
    id: `literal-proxy-fixture-${proxyFixtureSequence++}`,
    getKey: (row) => row.id,
    defaultIndexType: BasicIndex,
    sync: { sync: () => {} },
  })
  cleanups.push(() => collection.cleanup())
  let member: unknown
  const index = collection.createIndex((row) => {
    member = row[path]
    return row[path]
  })
  collection.removeIndex(index)
  expect(member).toBeDefined()
  return member
}

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

// A held-scan comparison and its local teardown are separate failures. Try
// every release and retain the comparison as the cause if teardown also fails.
async function cleanupAfterCheck(
  checkFailure: { reason: unknown } | undefined,
  releases: ReadonlyArray<() => Promise<unknown> | unknown>,
): Promise<void> {
  const cleanupFailures: Array<unknown> = []
  for (const release of releases) {
    try {
      await release()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length === 0) return
  if (checkFailure) {
    throw new AggregateError(
      [checkFailure.reason, ...cleanupFailures],
      `Ownership comparison and cleanup both failed`,
      { cause: checkFailure.reason },
    )
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  throw new AggregateError(cleanupFailures, `Ownership cleanup failed`, {
    cause: cleanupFailures[0],
  })
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
  persistedGcTime,
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
    persistedGcTime,
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
                      reserveCommitTurn: () => {},
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

// A persisted key from before literal singleton IN shared EQ's identity.
// Keep the historical bytes independent of the current encoder.
const legacySingletonCategoryDemandKey = `{"type":"loadSubsetDemand","query":{"type":"loadSubsetQuery","where":{"type":"func","name":"in","args":[{"type":"ref","path":[["string","category"]]},{"type":"val","value":["set",[["string","shared"]]]}]}}}`
const legacyAndSingletonCategoryDemandKey = `{"type":"loadSubsetDemand","query":{"type":"loadSubsetQuery","where":{"type":"func","name":"and","args":[{"type":"func","name":"in","args":[{"type":"ref","path":[["string","category"]]},{"type":"val","value":["set",[["string","shared"]]]}]}]}}}`
const legacyAndSingletonWithEqualityDemandKey = `{"type":"loadSubsetDemand","query":{"type":"loadSubsetQuery","where":{"type":"func","name":"and","args":[{"type":"func","name":"eq","args":[{"type":"ref","path":[["string","category"]]},{"type":"val","value":["string","shared"]}]},{"type":"func","name":"in","args":[{"type":"ref","path":[["string","category"]]},{"type":"val","value":["set",[["string","shared"]]]}]}]}}}`
const legacyProxyCategoryEqualityDemandKey = `{"type":"loadSubsetDemand","query":{"type":"loadSubsetQuery","where":{"type":"func","name":"eq","args":[{"type":"ref","path":[["string","category"]]},{"type":"val","value":{"type":"ref","path":[["string","category"]]}}]}}}`
const legacyProxyCategoryMembershipDemandKey = `{"type":"loadSubsetDemand","query":{"type":"loadSubsetQuery","where":{"type":"func","name":"in","args":[{"type":"ref","path":[["string","category"]]},{"type":"val","value":["set",[{"type":"ref","path":[["string","category"]]}]]}]}}}`

function proxyCategorySubset(operator: `eq` | `in`): LoadSubsetOptions {
  const member = literalProxy(`category`)
  return {
    where: new IR.Func(operator, [
      new IR.PropRef([`category`]),
      new IR.Value(operator === `in` ? [member] : member),
    ]),
  }
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
    options.offset !== undefined ||
    options.cursor !== undefined
  ) {
    throw new Error(`Ownership fixture does not support ordering or windows`)
  }
  // This fixture's insertion order is fixed. A finite prefix is enough for
  // the historical limit-owner history; ordering and cursors remain outside
  // its grammar.
  const window = (selectedRows: Array<Item>) =>
    options.limit === undefined
      ? selectedRows
      : selectedRows.slice(0, options.limit)
  const { where } = options
  if (!where) return window(Array.from(items, (item) => structuredClone(item)))
  const sourceRows = Array.from(items)
  if (sourceRows.length === 0) return []
  if (where.type === `func` && where.name === `and`) {
    return window(
      sourceRows
        .filter((item) =>
          where.args.every(
            (clause) =>
              selectOwnershipRows([item], { where: clause }).length === 1,
          ),
        )
        .map((item) => structuredClone(item)),
    )
  }
  if (
    where.type === `func` &&
    where.name === `eq` &&
    where.args.length === 2 &&
    where.args[0]?.type === `ref` &&
    where.args[0].path.length === 1 &&
    where.args[0].path[0] === `category` &&
    where.args[1]?.type === `val` &&
    typeof where.args[1].value === `string`
  ) {
    const category = where.args[1].value
    return window(
      sourceRows
        .filter((item) => item.category === category)
        .map((item) => structuredClone(item)),
    )
  }
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
  return window(
    sourceRows
      .filter((item) => categories.has(item.category))
      .map((item) => structuredClone(item)),
  )
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
  syncMode: `eager` | `on-demand` = `on-demand`,
  retentionOrConfigureClient:
    number | ((queryClient: QueryClient) => void) = Number.POSITIVE_INFINITY,
  configureClient?: (queryClient: QueryClient) => void,
  scanDeliveryGate?: { entered: () => void; released: Promise<void> },
) {
  const queryClient = createQueryClient()
  const persistedGcTime =
    typeof retentionOrConfigureClient === `number`
      ? retentionOrConfigureClient
      : Number.POSITIVE_INFINITY
  const setupClient =
    typeof retentionOrConfigureClient === `function`
      ? retentionOrConfigureClient
      : configureClient
  setupClient?.(queryClient)
  const providerRows = structuredClone(serverRows)
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      selectOwnershipRows(providerRows, context.meta?.loadSubsetOptions ?? {}),
    ),
  )
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn,
    getKey: (item) => item.id,
    syncMode,
    persistedGcTime,
    startSync: true,
  })
  const originalSync = queryOptions.sync
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      ...(scanDeliveryGate && {
        sync: {
          ...originalSync,
          sync: (params: Parameters<typeof originalSync.sync>[0]) => {
            const metadata = params.metadata
            const persistence = metadata?.persistence
            if (!metadata || !persistence) {
              throw new Error(`Persistence metadata is unavailable`)
            }
            return originalSync.sync({
              ...params,
              metadata: {
                ...metadata,
                persistence: {
                  ...persistence,
                  scanPersistedRows: async (options) => {
                    const scannedRows =
                      await persistence.scanPersistedRows(options)
                    if (options?.metadataOnly) {
                      // Hold delivery to Query DB after the storage scan has
                      // released its apply mutex, so other TTLs may commit.
                      scanDeliveryGate.entered()
                      await scanDeliveryGate.released
                    }
                    return scannedRows
                  },
                },
              },
            })
          },
        },
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

// The direct-write receipt follows the applied commit, regardless of whether
// the Query Collection already exposes the new row in memory.
function expectedDirectWriteReceipt(applied: boolean) {
  return {
    receipt: applied ? `fulfilled` : `pending`,
    storedName: applied ? `Updated` : shared.name,
  }
}

// A direct write can apply only in the current sync run. Cleanup start closes
// that admission; restart creates a new current run.
function expectedDirectWriteAdmission(syncRun: `current` | `invalidated`) {
  return syncRun === `current` ? `fulfilled` : `rejected`
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
    const scanPersistedRows = vi.fn((options?: SyncPersistenceScanOptions) =>
      options?.metadataOnly ? Promise.resolve([]) : pendingListScan.promise,
    )
    const fullScanCount = () =>
      scanPersistedRows.mock.calls.filter(([options]) => !options?.metadataOnly)
        .length
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
    await vi.waitFor(() => expect(fullScanCount()).toBe(1))

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
    await vi.waitFor(() => expect(fullScanCount()).toBe(2))
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

  /**
   * Error recovery law: a previous Query failure remains public while an
   * explicit retry is pending. A failed retry is another consecutive failure;
   * a successful retry clears the error. This follows the documented
   * `lastError`/`errorCount` reset-on-success contract. The model represents
   * only these three public error fields, not Collection status or row changes.
   *
   * The bounded history crosses a failed initial load, a failed background
   * refetch, or a failed Collection application with a held retry. One retry
   * holds Collection application after Query fetch success. A background
   * failure crosses an intermediate Query retry attempt before a held final
   * attempt. A repeated error at clock time zero distinguishes consecutive
   * failures from duplicate observer notifications. The real QueryClient and
   * `clearError()` are the driver.
   * The refinement check reads the public utils
   * when the retry starts but before its result settles, then after settlement.
   *
   * ORC-001: `query.ts` getter comments and the error-handling guide promise
   * reset on success. ORC-002/003/005: the three-state public model below is
   * separate from Query's timestamp and is checked at both named boundaries.
   * ORC-004/007: this is a bounded fixed matrix, not a generated property.
   * ORC-006: the original `clearError()` fails both initial pending cases;
   * an observer-success reset fails the application-error and held-application
   * cases; an unconditional error-result classifier recounts the old error
   * during a Query retry attempt; a zero timestamp sentinel fails the
   * epoch-zero repeated-error case.
   * ORC-008:
   * no model state is combined or removed. ORC-009: `retry pending` maps to
   * a held Query result; no new production concept is named. ORC-010: cleanup
   * settles the held result and retains primary assertion failures. ORC-011:
   * no plausible shared semantic helper needs a second formulation here.
   * The matrix does not cover concurrent retries for multiple tracked Queries,
   * mutation-handler fetch-boundary settlement, or deferred result application.
   */
  it.each([
    { priorFailure: `initial`, retryResult: `failure`, sameError: false },
    { priorFailure: `initial`, retryResult: `success`, sameError: false },
    { priorFailure: `background`, retryResult: `failure`, sameError: false },
    { priorFailure: `background`, retryResult: `success`, sameError: false },
    { priorFailure: `initial`, retryResult: `failure`, sameError: true },
  ] as const)(
    `keeps a $priorFailure error visible until a held retry $retryResult, same error $sameError`,
    async ({ priorFailure, retryResult, sameError }) => {
      const id = `held-error-retry-${priorFailure}-${retryResult}-${sameError}`
      const previousError = new Error(`previous failure`)
      const retryError = sameError ? previousError : new Error(`retry failure`)
      const heldResult = createDeferred<Array<Item>>()
      const queryClient = createQueryClient()
      const now = sameError ? vi.spyOn(Date, `now`).mockReturnValue(0) : null
      const queryFn = vi.fn<() => Promise<Array<Item>>>()
      if (priorFailure === `background`) {
        queryFn.mockResolvedValueOnce([shared])
      }
      queryFn.mockRejectedValueOnce(previousError)
      queryFn.mockImplementationOnce(() => heldResult.promise)
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
          syncMode: `eager`,
          startSync: true,
          retry: false,
        }),
      )
      cleanups.push(async () => {
        consoleError.mockRestore()
        now?.mockRestore()
        heldResult.resolve([])
        await collection.cleanup()
        queryClient.clear()
      })

      if (priorFailure === `initial`) {
        await expect(collection.stateWhenReady()).rejects.toBe(previousError)
      } else {
        await collection.stateWhenReady()
        await expect(
          collection.utils.refetch({ throwOnError: true }),
        ).rejects.toBe(previousError)
      }

      const observeError = () => ({
        lastError: collection.utils.lastError,
        isError: collection.utils.isError,
        errorCount: collection.utils.errorCount,
      })
      // An independent three-state model: pending retains the previous
      // failure; a failed retry advances the consecutive count; success resets.
      const expected = {
        pending: { lastError: previousError, isError: true, errorCount: 1 },
        failure: { lastError: retryError, isError: true, errorCount: 2 },
        success: { lastError: undefined, isError: false, errorCount: 0 },
      }
      expect(observeError()).toEqual(expected.pending)

      const retry = collection.utils.clearError().then(
        () => ({ outcome: `fulfilled` as const }),
        (error: unknown) => ({ outcome: `rejected` as const, error }),
      )
      await vi.waitFor(() =>
        expect(queryFn).toHaveBeenCalledTimes(
          priorFailure === `initial` ? 2 : 3,
        ),
      )
      expect(observeError()).toEqual(expected.pending)

      if (retryResult === `failure`) {
        heldResult.reject(retryError)
        expect(await retry).toEqual({ outcome: `rejected`, error: retryError })
      } else {
        heldResult.resolve([shared])
        expect(await retry).toEqual({ outcome: `fulfilled` })
      }
      expect(observeError()).toEqual(expected[retryResult])
    },
  )

  it.each([`success`, `failure`] as const)(
    `retains an application error while a held retry reaches %s`,
    async (retryResult) => {
      const id = `held-application-error-retry-${retryResult}`
      const applicationError = new Error(`application failed`)
      const retryError = new Error(`retry failed`)
      const heldResult = createDeferred<Array<Item>>()
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([shared])
        .mockImplementationOnce(() => heldResult.promise)
      let failApplication = true
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => {
            if (failApplication) {
              failApplication = false
              throw applicationError
            }
            return item.id
          },
          syncMode: `eager`,
          startSync: true,
          retry: false,
        }),
      )
      cleanups.push(async () => {
        heldResult.resolve([shared])
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
          consoleError.mockRestore()
        }
      })
      let retry:
        | Promise<
            { outcome: `fulfilled` } | { outcome: `rejected`; error: unknown }
          >
        | undefined
      try {
        await expect(collection.stateWhenReady()).rejects.toBe(applicationError)
        expect({
          lastError: collection.utils.lastError,
          isError: collection.utils.isError,
          errorCount: collection.utils.errorCount,
        }).toEqual({
          lastError: applicationError,
          isError: true,
          errorCount: 1,
        })

        retry = collection.utils.clearError().then(
          () => ({ outcome: `fulfilled` as const }),
          (error: unknown) => ({ outcome: `rejected` as const, error }),
        )
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
        // Query still holds its old successful result, despite the failed
        // Collection application. A fetch-start success notification is not recovery.
        expect({
          lastError: collection.utils.lastError,
          isError: collection.utils.isError,
          errorCount: collection.utils.errorCount,
        }).toEqual({
          lastError: applicationError,
          isError: true,
          errorCount: 1,
        })

        if (retryResult === `failure`) {
          heldResult.reject(retryError)
          expect(await retry).toEqual({
            outcome: `rejected`,
            error: retryError,
          })
          expect(collection.utils.lastError).toBe(retryError)
          expect(collection.utils.errorCount).toBe(2)
        } else {
          heldResult.resolve([shared])
          expect(await retry).toEqual({ outcome: `fulfilled` })
          expect(collection.utils.lastError).toBeUndefined()
          expect(collection.utils.errorCount).toBe(0)
        }
      } finally {
        heldResult.resolve([shared])
        await retry
      }
    },
  )

  it(`retains a Query error until a successful retry applies`, async () => {
    const id = `held-retry-application`
    const queryHash = hashKey([id])
    const previousError = new Error(`previous fetch failed`)
    const firstResult = createDeferred<Array<Item>>()
    const persistedScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => persistedScan.promise)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [firstResult.promise, [shared]],
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

    try {
      const initialLoad = collection._sync.loadSubset({})
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      firstResult.reject(previousError)
      await expect(
        Promise.resolve(initialLoad === true ? undefined : initialLoad),
      ).rejects.toBe(previousError)
      expect(collection.utils.lastError).toBe(previousError)
      expect(collection.utils.errorCount).toBe(1)

      const retry = collection.utils.clearError()
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(scanPersistedRows).toHaveBeenCalledOnce()
      })
      // Query has fetched successfully, but Collection application is held.
      expect(collection.utils.lastError).toBe(previousError)
      expect(collection.utils.isError).toBe(true)
      expect(collection.utils.errorCount).toBe(1)

      persistedScan.resolve([])
      await retry
      expect(collection.utils.lastError).toBeUndefined()
      expect(collection.utils.errorCount).toBe(0)
    } finally {
      firstResult.resolve([])
      persistedScan.resolve([])
    }
  })

  /**
   * A completed failure remains visible until a later successful result
   * applies. The model counts terminal failures, including reuse of the same
   * Error object in one clock tick. The persisted scan holds the older success
   * between fetch completion and application; the public checkpoint is after
   * that scan is released. This does not exercise native SQLite persistence.
   */
  it.each([`clearError`, `reused-error`] as const)(
    `does not let an older held revalidation clear a newer Query error after %s`,
    async (retryMode) => {
      const id = `held-revalidation-newer-error`
      const queryHash = hashKey([id])
      const previousError = new Error(`initial fetch failed`)
      const newerError =
        retryMode === `reused-error`
          ? previousError
          : new Error(`later fetch failed`)
      const dateNow =
        retryMode === `reused-error`
          ? vi.spyOn(Date, `now`).mockReturnValue(1_000)
          : undefined
      const firstResult = createDeferred<Array<Item>>()
      const laterResult = createDeferred<Array<Item>>()
      const persistedScan =
        createDeferred<
          Array<{ key: string | number; value: Item; metadata?: unknown }>
        >()
      const scanPersistedRows = vi.fn(() => persistedScan.promise)
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [firstResult.promise, [shared], laterResult.promise],
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
        dateNow?.mockRestore()
        return Promise.resolve()
      })

      try {
        const initialLoad = collection._sync.loadSubset({})
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
        firstResult.reject(previousError)
        await expect(
          Promise.resolve(initialLoad === true ? undefined : initialLoad),
        ).rejects.toBe(previousError)
        expect(collection.utils.lastError).toBe(previousError)

        const firstRetry = (
          retryMode === `clearError`
            ? collection.utils.clearError()
            : collection.utils.refetch({ throwOnError: true })
        ).then(
          () => ({ outcome: `fulfilled` as const }),
          (error: unknown) => ({ outcome: `rejected` as const, error }),
        )
        await vi.waitFor(() => {
          expect(queryFn).toHaveBeenCalledTimes(2)
          expect(scanPersistedRows).toHaveBeenCalledOnce()
        })
        expect(collection.utils.lastError).toBe(previousError)

        const secondRetry = collection.utils.refetch({ throwOnError: true })
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
        laterResult.reject(newerError)
        await expect(secondRetry).rejects.toBe(newerError)
        expect(collection.utils.lastError).toBe(newerError)
        expect(collection.utils.errorCount).toBe(2)

        persistedScan.resolve([])
        expect(await firstRetry).toEqual({ outcome: `fulfilled` })
        expect(collection.utils.lastError).toBe(newerError)
        expect(collection.utils.errorCount).toBe(2)
      } finally {
        firstResult.resolve([])
        laterResult.resolve([])
        persistedScan.resolve([])
      }
    },
  )

  it.each([`success`, `failure`] as const)(
    `does not recount the previous error during a Query retry attempt ending in %s`,
    async (outcome) => {
      const id = `held-query-retry-attempt-${outcome}`
      const previousError = new Error(`previous fetch failed`)
      const attemptError = new Error(`retry attempt failed`)
      const finalError = new Error(`retry finally failed`)
      const heldResult = createDeferred<Array<Item>>()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([shared])
        .mockRejectedValueOnce(previousError)
        .mockRejectedValueOnce(attemptError)
        .mockImplementationOnce(() => heldResult.promise)
      const queryClient = createQueryClient()
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
          syncMode: `eager`,
          startSync: true,
          retry: (count, error) => error === attemptError && count < 2,
          retryDelay: 0,
        }),
      )
      cleanups.push(async () => {
        heldResult.resolve([shared])
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
          consoleError.mockRestore()
        }
      })

      await collection.stateWhenReady()
      await expect(
        collection.utils.refetch({ throwOnError: true }),
      ).rejects.toBe(previousError)
      expect(collection.utils.errorCount).toBe(1)
      const retry = collection.utils.clearError().then(
        () => ({ outcome: `fulfilled` as const }),
        (error: unknown) => ({ outcome: `rejected` as const, error }),
      )
      try {
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(4))
        // Query retains its old error while its first retry attempt has failed.
        expect(collection.utils.lastError).toBe(previousError)
        expect(collection.utils.errorCount).toBe(1)
        if (outcome === `success`) {
          heldResult.resolve([shared])
          expect(await retry).toEqual({ outcome: `fulfilled` })
          expect(collection.utils.lastError).toBeUndefined()
          expect(collection.utils.errorCount).toBe(0)
        } else {
          heldResult.reject(finalError)
          expect(await retry).toEqual({
            outcome: `rejected`,
            error: finalError,
          })
          expect(collection.utils.lastError).toBe(finalError)
          expect(collection.utils.errorCount).toBe(2)
        }
      } finally {
        heldResult.resolve([shared])
        await retry
      }
    },
  )

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

  it(`rejects a late mutation write without restarting a cleaned-up collection`, async () => {
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
    await expect(mutation.isPersisted.promise).rejects.toBeInstanceOf(
      SyncNotInitializedError,
    )

    expect(collection.status).toBe(`cleaned-up`)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(itemIds(collection._state.syncedData.values())).toEqual([])
    expect(queryClient.getQueryData(queryKey)).toBeUndefined()
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
    const detailSubset = { where: eq(new IR.PropRef([`category`]), `detail`) }
    const listSubset = { where: eq(new IR.PropRef([`category`]), `list`) }
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

    const request = {}
    await collection._sync.loadSubset(request)
    let unloaded = false
    const subscription = collection.subscribeChanges(() => {
      if (!unloaded && collection.has(orphaned.id)) {
        unloaded = true
        collection._sync.unloadSubset(request)
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

  // Law: once a result's sync transaction is accepted, the rows it owns stay
  // owned when a later result supersedes it. The later result diffs against
  // that ownership, so a row only the superseded result added is deleted, and
  // a later empty result deletes the rest. Model: the owned rows after each
  // result are exactly that result's rows. Checkpoint: visible and stored rows
  // after each refetch settles.
  // Law: once a result's sync transaction is accepted, the rows it owns stay
  // owned when a later result supersedes it, whether durable storage or a
  // persisting mutation holds it. The later result diffs against that
  // ownership, so a row only the superseded result added is deleted, and a
  // later empty result deletes the rest. Model: the owned rows after each
  // result are exactly that result's rows. Checkpoint: visible and stored rows
  // after each refetch settles. Before this law, every supersession test held
  // durable storage, where the result's core transaction had already applied,
  // so restoring the old ownership was a no-op and no test observed it.
  it.each([`storage`, `mutation`] as const)(
    `keeps an accepted superseded result's ownership for the next diff when %s holds it`,
    async (holder) => {
      const id = `superseded-accepted-ownership-${holder}`
      const row = (key: string): Item => ({
        id: key,
        category: `result`,
        name: key.toUpperCase(),
      })
      let server: Array<Item> = [row(`a`)]
      const storage = createOwnershipStorage()
      const apply = storage.adapter.applyCommittedTx.bind(storage.adapter)
      let holdStorage = false
      const entered = createDeferred<void>()
      const released = createDeferred<void>()
      storage.adapter.applyCommittedTx = async (...args) => {
        if (holdStorage && args[1].mutations.length > 0) {
          holdStorage = false
          entered.resolve()
          await released.promise
        }
        return apply(...args)
      }
      const queryClient = createQueryClient()
      const options = queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve(structuredClone(server)),
        getKey: (item) => item.id,
        startSync: true,
      })
      const collection = createCollection(
        holder === `storage`
          ? persistedCollectionOptions<
              Item,
              string | number,
              never,
              QueryCollectionUtils<Item, string | number, Item, unknown>
            >({ ...options, persistence: { adapter: storage.adapter } })
          : options,
      )
      const mutation = createTransaction({
        mutationFn: () => released.promise,
      })
      cleanups.push(async () => {
        released.resolve()
        if (holder === `mutation`)
          await mutation.isPersisted.promise.catch(() => undefined)
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
        }
      })
      const observe = () => ({
        visible: [...collection.keys()].filter((key) => key !== `local`).sort(),
        stored:
          holder === `storage`
            ? storedItems(storage).map((item) => item.id)
            : [...collection._state.syncedData.keys()].sort(),
      })

      await collection.preload()
      expect(observe()).toEqual({ visible: [`a`], stored: [`a`] })

      // The first result is accepted and held before it can be stored or
      // published; a second result supersedes it.
      server = [row(`b`), row(`c`)]
      if (holder === `storage`) holdStorage = true
      else
        mutation.mutate(() =>
          collection.insert({ id: `local`, category: `local`, name: `L` }),
        )
      const first = collection.utils.refetch()
      if (holder === `storage`) await entered.promise
      else
        await vi.waitFor(() =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(0),
        )
      const queuedAfterFirst =
        collection._state.pendingSyncedTransactions.length
      server = [row(`b`)]
      const second = collection.utils.refetch()
      if (holder === `mutation`)
        await vi.waitFor(() =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(queuedAfterFirst),
        )
      released.resolve()
      await Promise.all([first, second])
      if (holder === `mutation`)
        await mutation.isPersisted.promise.catch(() => undefined)
      await vi.waitFor(() =>
        expect(observe()).toEqual({ visible: [`b`], stored: [`b`] }),
      )

      server = []
      await collection.utils.refetch()
      await vi.waitFor(() =>
        expect(observe()).toEqual({ visible: [], stored: [] }),
      )
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
      const merge = (fetched: Array<Row>, writes: Array<Row>) => {
        const rows = new Map(fetched.map((row) => [row.id, row]))
        for (const row of writes) rows.set(row.id, row)
        return Object.fromEntries(
          [...rows.values()].map((row) => [row.id, row.value]),
        )
      }
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
        expected = merge(fetched, [{ id: `3`, value: `c` }])
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
        expected = merge(fetched, [{ id: `3`, value: `c` }])
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
        expected = merge(fetched, [{ id: writtenKey, value: `B` }])
      }
      await vi.waitFor(() => expect(visible()).toEqual(expected))
      expect(cached()).toEqual(expected)
    },
  )

  /**
   * A fetched result can finish before its persisted baseline scan. Its
   * source rows retain their fetch-start position while that application is
   * queued. The reference overlays a later accepted direct write on those
   * rows, even if the scan returns that newly written row. Check public rows
   * when initial readiness settles, after the held scan is released.
   */
  it(`keeps a direct write made after fetch completion but before application`, async () => {
    const id = `queued-older-result-direct-write`
    const queryHash = hashKey([id])
    const older = { ...shared, name: `Older fetch` }
    const manual = { ...shared, name: `Manual` }
    const persistedScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => persistedScan.promise)
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [[older]],
      scanPersistedRows,
      setupMetadata: (metadata) => {
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        })
      },
    })
    cleanups.push(() => {
      persistedScan.resolve([])
      return Promise.resolve()
    })

    const ready = collection.stateWhenReady()
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledOnce()
      expect(scanPersistedRows).toHaveBeenCalledOnce()
    })
    await collection.utils.writeInsert(manual)
    expect(collection.get(manual.id)?.name).toBe(`Manual`)
    persistedScan.resolve([
      {
        key: manual.id,
        value: manual,
        metadata: { queryCollection: { owners: { [queryHash]: true } } },
      },
    ])
    await ready
    expect(collection.get(manual.id)?.name).toBe(`Manual`)

    // The accepted result is settled. An unrelated Query state notification
    // must not re-enter its older-result merge and patch the cache again.
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    let stateNotifications = 0
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === `updated` &&
        event.query === query &&
        event.action.type === `setState`
      )
        stateNotifications++
    })
    try {
      query.setState({ isInvalidated: true })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      expect(stateNotifications).toBe(1)
      expect(query.state.isInvalidated).toBe(true)
    } finally {
      unsubscribe()
    }
  })

  /**
   * A local cache edit has no server authority over a later direct update.
   * Real persistence contains the manual row when this notification arrives.
   * The public and durable values must agree after the observer processes it.
   */
  it(`keeps a persisted direct update through a local cache edit`, async () => {
    const id = `persisted-direct-cache-edit`
    const storage = createOwnershipStorage()
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [shared])
    const manual = { ...shared, name: `Manual` }
    const request = {}
    await collection._sync.loadSubset(request)
    await collection.utils.writeUpdate(manual)
    expect(storedItems(storage)[0]?.name).toBe(manual.name)

    queryClient.setQueryData([id], [shared])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(collection.get(shared.id)?.name).toBe(manual.name)
    expect(storedItems(storage)[0]?.name).toBe(manual.name)
    expect(queryFn).toHaveBeenCalledTimes(1)
    collection._sync.unloadSubset(request)
  })

  /**
   * A Query result fetched on one client predates a direct write stored by a
   * separate Collection. Dehydrate/hydrate carries that old result into a new
   * QueryClient but cannot prove it is newer than the durable row. The safe
   * independent account keeps Manual through the held physical request, then
   * accepts Fresh from that request. This real restart observes public and
   * durable values at both checkpoints; Query Core hydration supplies the old
   * cache entry, and the controlled provider supplies the later response.
   */
  it(`revalidates a hydrated Query result against a persisted direct write`, async () => {
    const id = `persisted-direct-hydrated-query`
    const queryKey = [id]
    const oldClient = createQueryClient()
    await oldClient.fetchQuery({
      queryKey,
      queryFn: () => Promise.resolve([shared]),
    })
    const dehydrated = dehydrate(oldClient)
    oldClient.clear()

    const hotStorage = createOwnershipStorage()
    const hot = createPersistedOwnershipFixture(id, hotStorage, [shared])
    const hotRequest = {}
    await hot.collection._sync.loadSubset(hotRequest)
    const manual = { ...shared, name: `Manual` }
    await hot.collection.utils.writeUpdate(manual)
    expect(storedItems(hotStorage)[0]?.name).toBe(manual.name)
    hot.collection._sync.unloadSubset(hotRequest)
    await hot.collection.cleanup()

    const coldStorage = createOwnershipStorage(hotStorage.snapshot())
    const cold = createPersistedOwnershipFixture(
      id,
      coldStorage,
      [{ ...shared, name: `Fresh` }],
      `on-demand`,
      (client) => hydrate(client, dehydrated),
    )
    expect(cold.queryClient.getQueryData<Array<Item>>(queryKey)).toEqual([
      shared,
    ])
    const response = createDeferred<Array<Item>>()
    const providerStarted = createDeferred<void>()
    cold.queryFn.mockImplementation(() => {
      providerStarted.resolve()
      return response.promise
    })
    cleanups.push(() => Promise.resolve(response.resolve([])))
    const publicNames: Array<string | undefined> = []
    const subscription = cold.collection.subscribeChanges(
      () => publicNames.push(cold.collection.get(shared.id)?.name),
      { includeInitialState: false },
    )
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    expect(storedItems(coldStorage)[0]?.name).toBe(`Manual`)

    const coldRequest = {}
    const load = Promise.resolve(cold.collection._sync.loadSubset(coldRequest))
    void load.catch(() => undefined)
    const firstCut = await Promise.race([
      load.then(
        () => `load-fulfilled` as const,
        () => `load-rejected` as const,
      ),
      providerStarted.promise.then(() => `provider-started` as const),
    ])
    expect(firstCut).toBe(`provider-started`)
    expect(cold.queryFn).toHaveBeenCalledTimes(1)
    expect(cold.collection.get(shared.id)?.name).not.toBe(shared.name)
    expect(storedItems(coldStorage)[0]?.name).toBe(`Manual`)
    expect(publicNames).not.toContain(shared.name)

    response.resolve([{ ...shared, name: `Fresh` }])
    await load
    expect(cold.collection.get(shared.id)?.name).toBe(`Fresh`)
    expect(storedItems(coldStorage)[0]?.name).toBe(`Fresh`)
    expect(publicNames).not.toContain(shared.name)
    cold.collection._sync.unloadSubset(coldRequest)
  })

  it(`settles a direct write only after its persisted commit applies`, async () => {
    const id = `persisted-direct-write-receipt`
    const storage = createOwnershipStorage(undefined, 2)
    const { collection } = createPersistedOwnershipFixture(
      id,
      storage,
      [shared],
      `eager`,
    )
    await collection.stateWhenReady()

    let receipt: `pending` | `fulfilled` | `rejected` = `pending`
    const write = collection.utils.writeUpdate({ ...shared, name: `Updated` })
    void write.then(
      () => (receipt = `fulfilled`),
      () => (receipt = `rejected`),
    )
    const observe = () => ({
      receipt,
      storedName: storage.snapshot().rows.get(shared.id)?.name,
    })

    await storage.entered
    await Promise.resolve()
    expect(observe()).toEqual(expectedDirectWriteReceipt(false))

    storage.release()
    await write
    expect(observe()).toEqual(expectedDirectWriteReceipt(true))
    expect(collection.get(shared.id)?.name).toBe(`Updated`)
  })

  /**
   * A Query refetch may begin while a direct write waits for its persisted
   * commit. Starting that request repeats the old cached success to observers,
   * but no new provider row has arrived. The independent reference has three
   * row states in order: the first fetched Server row, the accepted Manual
   * write, and the later fetched Newer row. The old cached row cannot become
   * authoritative again at refetch start.
   *
   * The legal history holds the direct commit, starts a real QueryClient
   * refetch whose provider response is also held, then releases the commit.
   * At the write receipt, while the response is still held, compare public
   * and durable rows with Manual. After the provider responds, compare both
   * with Newer. These two cuts reject a design that treats a fetch-start
   * observer notification as a fresh result without forbidding a later
   * physical result from replacing the direct write.
   */
  it.each([`eager`, `on-demand`] as const)(
    `keeps an accepted persisted %s write through a refetch start until its result arrives`,
    async (syncMode) => {
      const id = `persisted-direct-write-refetch-start-${syncMode}`
      const storage = createOwnershipStorage(undefined, 2)
      const queryClient = createQueryClient()
      const newer = { ...shared, name: `Newer` }
      const manual = { ...shared, name: `Manual` }
      const heldResult = createDeferred<Array<Item>>()
      const requestStarted = createDeferred<void>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([shared])
        .mockImplementationOnce(() => {
          requestStarted.resolve()
          return heldResult.promise
        })
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
            syncMode,
            persistedGcTime: Number.POSITIVE_INFINITY,
            startSync: true,
          }),
          persistence: { adapter: storage.adapter },
        }),
      )
      cleanups.push(async () => {
        storage.release()
        heldResult.resolve([newer])
        await collection.cleanup()
        queryClient.clear()
      })

      if (syncMode === `eager`) await collection.stateWhenReady()
      else await collection._sync.loadSubset({})
      expect(collection.get(shared.id)?.name).toBe(shared.name)
      expect(storedItems(storage)[0]?.name).toBe(shared.name)

      const write = collection.utils.writeUpdate(manual)
      await storage.entered
      const refetch = queryClient.refetchQueries({ queryKey: [id] })
      void refetch.catch(() => undefined)
      await requestStarted.promise
      expect(queryFn).toHaveBeenCalledTimes(2)

      storage.release()
      await write
      expect({
        public: collection.get(shared.id)?.name,
        durable: storedItems(storage)[0]?.name,
      }).toEqual({ public: manual.name, durable: manual.name })

      heldResult.resolve([newer])
      await refetch
      expect({
        public: collection.get(shared.id)?.name,
        durable: storedItems(storage)[0]?.name,
      }).toEqual({ public: newer.name, durable: newer.name })
    },
  )

  it(`rejects writes from an invalidated sync run and admits writes after restart`, async () => {
    const id = `direct-write-cleanup-admission`
    const storage = createOwnershipStorage()
    const { collection } = createPersistedOwnershipFixture(
      id,
      storage,
      [shared],
      `eager`,
    )
    await collection.stateWhenReady()

    const observe = async (write: () => Promise<void>) => {
      try {
        await write()
        return `fulfilled` as const
      } catch (error) {
        expect(error).toBeInstanceOf(SyncNotInitializedError)
        return `rejected` as const
      }
    }

    const before = { ...shared, name: `Before cleanup` }
    expect(await observe(() => collection.utils.writeUpdate(before))).toBe(
      expectedDirectWriteAdmission(`current`),
    )
    expect(storage.snapshot().rows.get(shared.id)?.name).toBe(before.name)

    const cleanup = collection.cleanup()
    const late = { id: `late`, category: `direct`, name: `Late` }
    const lateWrites = [
      () => collection.utils.writeInsert(late),
      () => collection.utils.writeUpdate({ ...shared, name: `Late update` }),
      () => collection.utils.writeDelete(shared.id),
      () => collection.utils.writeUpsert(late),
      () =>
        collection.utils.writeBatch(() => collection.utils.writeInsert(late)),
    ]
    for (const write of lateWrites) {
      expect(await observe(write)).toBe(
        expectedDirectWriteAdmission(`invalidated`),
      )
    }
    await cleanup
    expect(storage.snapshot().rows.has(late.id)).toBe(false)
    expect(storage.snapshot().rows.get(shared.id)?.name).toBe(before.name)

    const subscription = collection.subscribeChanges(() => {})
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    await collection.stateWhenReady()
    const restarted = {
      id: `restarted`,
      category: `direct`,
      name: `Restarted`,
    }
    expect(await observe(() => collection.utils.writeInsert(restarted))).toBe(
      expectedDirectWriteAdmission(`current`),
    )
    expect(storage.snapshot().rows.get(restarted.id)).toEqual(restarted)
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
              return params.begin()
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
    const subset = { where: categoryIn(`shared`, `detail`) }

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
    const detail = { where: categoryIn(`shared`, `detail`) }
    const list = { where: categoryIn(`shared`, `list`) }

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
      const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
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
      const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
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

  /**
   * A returned load promise transfers one acquisition lease even while
   * retention maintenance holds its start. Reusing the same options object
   * does not merge those leases: one unload retires the newest call, so the
   * older call may still fetch and publish its source row. The test enters
   * Query DB after sync starts; Core's earlier deferred-request queue is a
   * separate boundary.
   */
  it(`releases the newest same-options acquisition during startup maintenance`, async () => {
    const id = `repeated-options-startup-retention`
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const scopeHash = hashKey([id, getLoadSubsetDemandKey(subset)])
    const retentionKey = `queryCollection:gc:${scopeHash}`
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[shared]],
      setupMetadata: (metadata) =>
        metadata.collection.set(retentionKey, {
          queryHash: scopeHash,
          mode: `until-revalidated`,
        }),
    })
    collection.startSyncImmediate()
    const first = Promise.resolve(collection._sync.loadSubset(subset)).then(
      () => `ready`,
      (error: unknown) => error,
    )
    const second = Promise.resolve(collection._sync.loadSubset(subset)).then(
      () => `ready`,
      (error: unknown) => error,
    )

    collection._sync.unloadSubset(subset)
    await expect(first).resolves.toBe(`ready`)
    await expect(second).resolves.toMatchObject({ name: `AbortError` })
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toEqual([shared.id])

    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([])
  })

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
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
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
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
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

  /**
   * A direct insert changes the Collection independently of Query result
   * ownership. The previous direct-write contract permits this surgical
   * change even though the adapter cannot infer a subset owner for the row.
   * In this legal history, the fetched row belongs to one loaded subset and
   * the direct row belongs to no subset. The independent expected-key set
   * removes only the fetched row when that subset unloads. The production
   * driver uses the public write utilities and a real QueryClient; after the
   * accepted write, unload, and explicit delete, compare public Collection
   * keys and provider calls. This does not promise a bounded lifetime for an
   * unowned direct row that the caller never deletes.
   */
  it(`keeps a direct insert after its queried subset unloads`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `direct-insert-without-query-owner`,
      results: [[shared]],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const inserted = { id: `direct`, category: `shared`, name: `Direct` }
    const expectedKeys = new Set([shared.id])

    await collection._sync.loadSubset(subset)
    await collection.utils.writeInsert(inserted)
    expectedKeys.add(inserted.id)
    expect(rows(collection)).toEqual([...expectedKeys].sort())

    collection._sync.unloadSubset(subset)
    expectedKeys.delete(shared.id)
    expect(rows(collection)).toEqual([...expectedKeys].sort())
    expect(queryFn).toHaveBeenCalledOnce()

    await collection.utils.writeDelete(inserted.id)
    expectedKeys.delete(inserted.id)
    expect(rows(collection)).toEqual([...expectedKeys].sort())
  })

  /**
   * An explicit complete scoped result settles a directly inserted row in its
   * scope. The independent reference first accepts the surgical insert, then
   * replaces that scope with the empty server result at refetch settlement.
   * Ordinary subset unload above is distinct: it supplies no new server fact.
   */
  it(`removes an ownerless on-demand insert after an empty explicit refetch`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `on-demand-direct-insert-empty-refetch`,
      results: [[], []],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    await collection._sync.loadSubset(subset)
    await collection.utils.writeInsert(shared)
    expect(rows(collection)).toEqual([shared.id])

    await collection.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows(collection)).toEqual([])
  })

  /**
   * The reference treats only a successful, complete result for a row's
   * predicate as evidence that an omitted direct row is gone. A disjoint
   * predicate, a limited/offset/cursor window, and a failed request provide
   * no such fact.
   * Nonempty omission rejects an implementation that recognizes only empty
   * results. Each history compares public rows at refetch settlement.
   */
  it.each([
    {
      history: `complete-nonempty`,
      category: `shared`,
      window: {},
      removes: true,
    },
    { history: `disjoint`, category: `other`, window: {}, removes: false },
    {
      history: `limited`,
      category: `shared`,
      window: { limit: 1 },
      removes: false,
    },
    {
      history: `offset`,
      category: `shared`,
      window: { offset: 1 },
      removes: false,
    },
    {
      history: `cursor`,
      category: `shared`,
      window: {
        cursor: {
          whereFrom: eq(new IR.PropRef([`id`]), `other`),
          whereCurrent: eq(new IR.PropRef([`id`]), `other`),
          lastKey: `other`,
        },
      },
      removes: false,
    },
  ] as const)(
    `reconciles an ownerless direct row after a $history refetch`,
    async ({ history, category, window, removes }) => {
      const other = { id: `other`, category, name: `Other` }
      const { collection, queryFn } = createOwnershipFixture({
        id: `ownerless-refetch-${history}`,
        results: [[], [other]],
      })
      const subset = {
        where: eq(new IR.PropRef([`category`]), category),
        ...window,
      }
      await collection._sync.loadSubset(subset)
      await collection.utils.writeInsert(shared)
      await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(rows(collection)).toEqual(
        removes ? [other.id] : [other.id, shared.id],
      )
    },
  )

  /**
   * An empty provider response is not evidence of global absence. The
   * reference keeps an ownerless direct row when the complete predicate is
   * disjoint or the request covers only a window. The provider has no server
   * rows, so each empty response is a legal result for its request. Compare
   * public keys when the explicit refetch has applied.
   */
  it.each([
    {
      history: `disjoint-empty`,
      where: eq(new IR.PropRef([`category`]), `other`),
      window: {},
    },
    {
      history: `offset-empty`,
      where: eq(new IR.PropRef([`category`]), `shared`),
      window: { offset: 1 },
    },
    {
      history: `cursor-empty`,
      where: eq(new IR.PropRef([`category`]), `shared`),
      window: {
        cursor: {
          whereFrom: eq(new IR.PropRef([`id`]), `other`),
          whereCurrent: eq(new IR.PropRef([`id`]), `other`),
          lastKey: `other`,
        },
      },
    },
  ] as const)(
    `keeps an ownerless direct row after a $history refetch`,
    async ({ history, where, window }) => {
      const { collection, queryFn } = createOwnershipFixture({
        id: `ownerless-${history}`,
        results: [[], []],
      })
      const subset = { where, ...window }
      await collection._sync.loadSubset(subset)
      await collection.utils.writeInsert(shared)
      await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(rows(collection)).toEqual([shared.id])
    },
  )

  /**
   * A compound predicate remains a scope boundary. The independent rule
   * evaluates both conjuncts on the accepted direct row before deciding
   * whether a complete empty result can retire it.
   */
  it.each([
    { history: `matching`, id: shared.id, removes: true },
    { history: `disjoint`, id: `other`, removes: false },
  ] as const)(
    `reconciles a direct row after a $history compound-scope refetch`,
    async ({ history, id, removes }) => {
      const { collection, queryFn } = createOwnershipFixture({
        id: `ownerless-compound-${history}`,
        results: [[], []],
      })
      const subset = {
        where: new IR.Func(`and`, [
          eq(new IR.PropRef([`category`]), `shared`),
          eq(new IR.PropRef([`id`]), id),
        ]),
      }
      await collection._sync.loadSubset(subset)
      await collection.utils.writeInsert(shared)
      await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(rows(collection)).toEqual(removes ? [] : [shared.id])
    },
  )

  /** A failed response provides no complete scope and cannot retire a row. */
  it(`keeps an ownerless direct row when explicit refetch fails`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `ownerless-failed-refetch`,
      results: [[]],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    await collection._sync.loadSubset(subset)
    await collection.utils.writeInsert(shared)
    queryFn.mockRejectedValueOnce(new Error(`source unavailable`))
    await expect(
      collection.utils.refetch({ throwOnError: true }),
    ).rejects.toThrow(`source unavailable`)
    expect(rows(collection)).toEqual([shared.id])
  })

  /**
   * An eager refetch is a complete source snapshot. A direct insert changes
   * the public row set without fetching, but a later explicit refetch with an
   * empty server result removes that key. The independent reference replaces
   * its full row set with the returned snapshot at refetch settlement. This
   * crosses the public write/refetch path and compares both rows and requests.
   */
  it(`reconciles an eager direct insert against a later empty refetch`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `eager-direct-insert-refetch`,
      results: [[], []],
      syncMode: `eager`,
    })
    await collection.preload()
    expect(rows(collection)).toEqual([])
    await collection.utils.writeInsert(shared)
    expect(rows(collection)).toEqual([shared.id])
    await collection.utils.refetch()
    expect(rows(collection)).toEqual([])
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A direct eager insert need not inherit the prior fetched result's owner.
   * The next complete provider snapshot can claim that same key and replace
   * its value; a following empty snapshot removes it. The independent eager
   * reference replaces its full row set at each explicit refetch settlement.
   */
  it(`claims and later removes an eager direct insert through server snapshots`, async () => {
    const server = { ...shared, name: `Server` }
    const { collection, queryFn } = createOwnershipFixture({
      id: `eager-direct-insert-later-claim`,
      results: [[], [server], []],
      syncMode: `eager`,
    })
    await collection.preload()
    await collection.utils.writeInsert({ ...shared, name: `Direct` })
    expect(collection.get(shared.id)?.name).toBe(`Direct`)
    await collection.utils.refetch()
    expect(collection.get(shared.id)?.name).toBe(`Server`)
    await collection.utils.refetch()
    expect(collection.has(shared.id)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

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
    async ({ ownerCount, withMetadata, history }) => {
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
    },
  )

  /**
   * A direct update preserves both subset claims in durable metadata. A fresh
   * Collection over those stored rows can retire one claim after an empty
   * result without losing the peer's row, then retire the final claim and the
   * row. The reference is the authored set of two demand identities; each
   * empty result removes only its own identity. Cloning the durable snapshot
   * represents a new process without asking cleanup to retire the old run's
   * active demands. Compare exact stored owners and public rows after each
   * revalidation, not just their cardinality.
   */
  it(`retires overlapping persisted owners after a direct update and restart`, async () => {
    const id = `direct-update-overlap-persisted-restart`
    const first = categorySubset(`detail`)
    const second = categorySubset(`list`)
    const firstHash = hashKey([id, getLoadSubsetDemandKey(first)])
    const secondHash = hashKey([id, getLoadSubsetDemandKey(second)])
    const hotStorage = createOwnershipStorage()
    const hot = createPersistedOwnershipFixture(id, hotStorage, [shared])

    await hot.collection._sync.loadSubset(first)
    await hot.collection._sync.loadSubset(second)
    await hot.collection.utils.writeUpdate({ id: shared.id, name: `Updated` })
    const durable = hotStorage.snapshot()
    expect(durable.rows.get(shared.id)?.name).toBe(`Updated`)
    expect(persistedOwners(durable.rowMetadata, shared.id)).toEqual(
      [firstHash, secondHash].sort(),
    )

    const coldStorage = createOwnershipStorage(durable)
    const cold = createPersistedOwnershipFixture(id, coldStorage, [])
    await cold.collection._sync.loadSubset(first)
    expect(cold.collection.get(shared.id)?.name).toBe(`Updated`)
    expect(
      persistedOwners(coldStorage.snapshot().rowMetadata, shared.id),
    ).toEqual([secondHash])

    await cold.collection._sync.loadSubset(second)
    expect(cold.collection.has(shared.id)).toBe(false)
    const settled = coldStorage.snapshot()
    expect(settled.rows.has(shared.id)).toBe(false)
    expect(persistedOwners(settled.rowMetadata, shared.id)).toEqual([])
    expect(hot.queryFn).toHaveBeenCalledTimes(2)
    expect(cold.queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * SQLite is the receiving boundary for the row-lifetime rule. A fetched
   * lifetime ends at direct deletion; reinserting the key creates a durable
   * unowned row. Releasing both old subset leases and restarting the Collection
   * must not turn their retired claims into a deletion of that row.
   */
  it(`keeps a reinserted direct row across SQLite subset release and restart`, async () => {
    const id = `direct-row-lifetime-sqlite-restart`
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const makeCollection = (client: QueryClient, source: typeof queryFn) =>
      createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient: client,
            queryKey: [id],
            queryFn: source,
            getKey: (item) => item.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
          persistence: managed,
        }),
      )
    const collection = makeCollection(queryClient, queryFn)
    const first = { limit: 1 }
    const second = { limit: 2 }
    const replacement = { ...shared, name: `Reinserted` }
    const restart: {
      collection?: ReturnType<typeof makeCollection>
      client?: QueryClient
    } = {}
    cleanups.push(async () => {
      await restart.collection?.cleanup()
      await collection.cleanup()
      queryClient.clear()
      restart.client?.clear()
      driver.close()
    })

    await collection._sync.loadSubset(first)
    await collection._sync.loadSubset(second)
    await collection.utils.writeDelete(shared.id)
    await collection.utils.writeInsert(replacement)
    collection._sync.unloadSubset(first)
    collection._sync.unloadSubset(second)
    expect(collection.get(shared.id)?.name).toBe(replacement.name)

    await collection.cleanup()
    restart.client = createQueryClient()
    restart.collection = makeCollection(
      restart.client,
      vi.fn(() => Promise.resolve([])),
    )
    await restart.collection._sync.loadSubset(first)
    expect(restart.collection.get(shared.id)?.name).toBe(replacement.name)
  })

  /**
   * A fresh persisted run no longer has the writer's in-memory position, but
   * an explicit complete source result still settles an omitted direct row.
   * The reference has a durable insert followed by an empty complete-scope fetch:
   * the row exists before that fetch and is absent when it applies. This is
   * separate from the limited-window restart above, whose omission proves
   * nothing about a row outside its window. A disjoint durable row remains
   * stored because the filtered result says nothing about it. Its public
   * visibility requires acquiring its own on-demand scope after restart.
   */
  it(`retires a persisted ownerless row after a complete empty result`, async () => {
    const id = `persisted-ownerless-complete-result`
    const disjoint = {
      id: `persisted-disjoint`,
      category: `other`,
      name: `Other`,
    }
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([] as Array<Item>))
    const makeCollection = (client: QueryClient) =>
      createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient: client,
            queryKey: [id],
            queryFn,
            getKey: (item) => item.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
          persistence: managed,
        }),
      )
    const first = makeCollection(queryClient)
    const restart: { collection?: ReturnType<typeof makeCollection> } = {}
    const secondClient = createQueryClient()
    cleanups.push(async () => {
      await restart.collection?.cleanup()
      await first.cleanup()
      queryClient.clear()
      secondClient.clear()
      driver.close()
    })
    await vi.waitFor(() => expect(first.status).toBe(`ready`))
    await first.utils.writeInsert(shared)
    await first.utils.writeInsert(disjoint)
    expect(first.has(shared.id)).toBe(true)
    expect(first.has(disjoint.id)).toBe(true)
    await first.cleanup()
    const claim = await managed.adapter.claimCacheGeneration!(id)
    try {
      const durable = await managed.adapter.loadResumeSnapshot({
        kind: `managed`,
        storageCollectionId: claim.storageCollectionId,
        claimId: claim.claimId,
      })
      expect(durable.rows.find((row) => row.key === shared.id)?.value).toEqual(
        shared,
      )
      expect(
        durable.rows.find((row) => row.key === disjoint.id)?.value,
      ).toEqual(disjoint)
    } finally {
      await managed.adapter.releaseCacheGenerationClaim!(claim.claimId)
    }
    restart.collection = makeCollection(secondClient)
    await restart.collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `shared`),
    })
    expect(queryFn).toHaveBeenCalledOnce()
    expect(restart.collection.has(shared.id)).toBe(false)
    const settledClaim = await managed.adapter.claimCacheGeneration!(id)
    try {
      const durable = await managed.adapter.loadResumeSnapshot({
        kind: `managed`,
        storageCollectionId: settledClaim.storageCollectionId,
        claimId: settledClaim.claimId,
      })
      expect(durable.rows.some((row) => row.key === shared.id)).toBe(false)
      expect(
        durable.rows.find((row) => row.key === disjoint.id)?.value,
      ).toEqual(disjoint)
    } finally {
      await managed.adapter.releaseCacheGenerationClaim!(settledClaim.claimId)
    }
  })

  /**
   * Direct writes previously promised to change the synced rows without an
   * automatic Query refetch. The pre-#1826 user guide and QueryCollectionUtils
   * API comments stated that promise. It lets a caller apply one server event
   * without requesting every active subset again. A later, independently
   * scheduled queryFn result may still replace the write.
   *
   * The independent reference filters the event-updated rows by category.
   * The legal history loads ten disjoint live queries, then upserts, updates,
   * deletes, inserts, and batches rows across their scopes. The production
   * driver records real queryFn requests. After each accepted write, public
   * rows must reflect the event and no new provider request may have started
   * because of the write. This does not promise that direct writes
   * maintain exact Query cache entries for arbitrary scoped or windowed
   * requests; the caller controls that lower-level consistency risk.
   */
  it(`direct write changes one row without requesting active subsets`, async () => {
    const id = `scoped-direct-write-work`
    const queryClient = createQueryClient()
    const categories = Array.from(
      { length: 10 },
      (_, index) => `category-${index}`,
    )
    const providerRows = new Map<string, Item>(
      categories.map((category) => [
        category,
        { id: category, category, name: `Before` },
      ]),
    )
    const providerCalls: Array<string> = []
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      const where = context.meta?.loadSubsetOptions?.where
      const category =
        where?.type === `func`
          ? where.args.find((arg) => arg.type === `val`)?.value
          : undefined
      if (typeof category !== `string`) {
        throw new Error(`Expected an equality subset with a category`)
      }
      providerCalls.push(category)
      return Promise.resolve(
        [...providerRows.values()]
          .filter((row) => row.category === category)
          .map((row) => structuredClone(row)),
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
    const liveQueries = categories.map((category) =>
      createLiveQueryCollection({
        query: (query) =>
          query
            .from({ item: collection })
            .where(({ item }) => eq(item.category, category)),
      }),
    )
    cleanups.push(async () => {
      await Promise.all(liveQueries.map((query) => query.cleanup()))
      await collection.cleanup()
      queryClient.clear()
    })

    await Promise.all(liveQueries.map((query) => query.preload()))
    expect(providerCalls).toHaveLength(categories.length)

    const expectDirectWrite = async (write: () => Promise<void>) => {
      const callsBeforeWrite = providerCalls.length
      await write()
      for (const [index, category] of categories.entries()) {
        const expectedRows = [...providerRows.values()].filter(
          (row) => row.category === category,
        )
        expect(
          liveQueries[index]!.toArray.map((row) => row.name).sort(),
        ).toEqual(expectedRows.map((row) => row.name).sort())
      }
      expect(providerCalls.slice(callsBeforeWrite)).toEqual([])
    }

    const changed = {
      ...providerRows.get(categories[3]!)!,
      name: `After`,
    }
    providerRows.set(changed.id, changed)
    await expectDirectWrite(() =>
      collection.utils.writeUpsert(structuredClone(changed)),
    )

    const updated = { ...changed, name: `Updated` }
    providerRows.set(updated.id, updated)
    await expectDirectWrite(() =>
      collection.utils.writeUpdate({ id: updated.id, name: updated.name }),
    )

    providerRows.delete(updated.id)
    await expectDirectWrite(() => collection.utils.writeDelete(updated.id))

    const inserted = {
      id: `inserted`,
      category: categories[3]!,
      name: `Inserted`,
    }
    providerRows.set(inserted.id, inserted)
    await expectDirectWrite(() => collection.utils.writeInsert(inserted))

    const batched = {
      id: `batched`,
      category: categories[4]!,
      name: `Batched`,
    }
    const batchUpdated = {
      ...providerRows.get(categories[4]!)!,
      name: `Batch updated`,
    }
    providerRows.set(batched.id, batched)
    providerRows.set(batchUpdated.id, batchUpdated)
    await expectDirectWrite(() =>
      collection.utils.writeBatch(() => {
        collection.utils.writeInsert(batched)
        collection.utils.writeUpdate({
          id: batchUpdated.id,
          name: batchUpdated.name,
        })
      }),
    )
  })

  /**
   * A direct delete cannot infer the row that fills a limited provider window.
   * The independent source model slices eleven ordered rows to ten. Deleting
   * the first row leaves nine cached rows under infinite stale time, even after
   * reacquisition; an explicit refetch returns the next ten-row source slice.
   * The public checkpoint is the row set and request count after each load and
   * after refetch. This documents the lower-level API's exactness boundary.
   */
  it(`refills a directly shortened window only after explicit refetch`, async () => {
    type Row = { id: string; rank: number }
    const id = `direct-delete-window-refill`
    const queryClient = createQueryClient()
    const source = Array.from({ length: 11 }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const queryFn = vi.fn((context: QueryFunctionContext) =>
      Promise.resolve(
        source
          .slice(0, context.meta?.loadSubsetOptions?.limit ?? source.length)
          .map((row) => ({ ...row })),
      ),
    )
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        staleTime: Infinity,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const demand = { limit: 10 }
    await collection._sync.loadSubset(demand)
    expect(rows(collection)).toEqual(
      source
        .slice(0, 10)
        .map((row) => row.id)
        .sort(),
    )
    source.shift()
    await collection.utils.writeDelete(`0`)
    expect(rows(collection)).toHaveLength(9)
    collection._sync.unloadSubset(demand)
    await collection._sync.loadSubset(demand)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toHaveLength(9)
    await collection.utils.refetch()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows(collection)).toEqual(
      source
        .slice(0, 10)
        .map((row) => row.id)
        .sort(),
    )
  })

  /**
   * A deferred refresh barrier is legal during offline replay. It delays
   * application of fetched data, but it does not turn a direct write into a
   * request. No Query request is in flight in this history, so the independent
   * reference keeps the accepted event row. The history loads one on-demand
   * Query, holds the barrier, writes, then releases it. It observes public
   * rows and real queryFn calls after the accepted write and barrier release;
   * it does not model the full OfflineExecutor.
   */
  it(`does not refetch a direct write after a deferred refresh barrier`, async () => {
    const id = `deferred-direct-write-no-refetch`
    const initial = { id: `row`, category: `A`, name: `Before` }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([structuredClone(initial)]))
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
    const barrier = createDeferred<void>()
    const release = barrier.promise.finally(() => {
      collection.deferDataRefresh = null
    })
    cleanups.push(async () => {
      barrier.resolve()
      await release
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    expect(queryFn).toHaveBeenCalledTimes(1)
    collection.deferDataRefresh = barrier.promise
    await collection.utils.writeUpdate({ id: initial.id, name: `After` })
    expect(collection.get(initial.id)?.name).toBe(`After`)
    expect(queryFn).toHaveBeenCalledTimes(1)

    barrier.resolve()
    await release
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(collection.get(initial.id)?.name).toBe(`After`)
  })

  /**
   * A directly selected array is a writable part of the Query response.
   * Unlike a derived projection, replacing this property preserves the
   * envelope. The authored response predicts both the changed row and the
   * unchanged metadata after an accepted on-demand direct write.
   */
  it(`patches a directly selected on-demand cache array without refetching`, async () => {
    const id = `direct-select-direct-write`
    const initial = { id: `row`, category: `A`, name: `Before` }
    const response = { items: [initial], pageInfo: { hasNextPage: false } }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) => value.items,
        getKey: (item: Item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    await collection.utils.writeUpdate({ id: initial.id, name: `After` })

    expect(queryClient.getQueryData([id])).toEqual({
      items: [{ ...initial, name: `After` }],
      pageInfo: response.pageInfo,
    })
    expect(collection.get(initial.id)?.name).toBe(`After`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * A derived select reads rows from an envelope but gives no inverse for a
   * direct cache write. The documented edges-to-nodes projection is legal.
   * A direct write may leave its Query cache row stale, but the cached value
   * must remain a valid response for select. The response shape is the
   * independent reference; the driver loads it through a real QueryClient,
   * then checks the cache, public Collection row, and request count after the
   * accepted write. This does not require an inverse projection.
   */
  it(`keeps a derived selected cache response valid after a direct write`, async () => {
    const id = `derived-select-direct-write`
    const initial = { id: `row`, category: `A`, name: `Before` }
    const response = {
      edges: [{ cursor: `cursor-1`, node: initial }],
      pageInfo: { hasNextPage: false },
    }
    const select = (value: typeof response) =>
      value.edges.map((edge) => edge.node)
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select,
        getKey: (item: Item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    expect(queryClient.getQueryData([id])).toEqual(response)
    await collection.utils.writeUpdate({ id: initial.id, name: `After` })

    const cached = queryClient.getQueryData<typeof response>([id])!
    expect(cached.edges).toEqual([
      expect.objectContaining({
        cursor: `cursor-1`,
        node: expect.objectContaining({ id: initial.id }),
      }),
    ])
    expect(select(cached)).toEqual([
      expect.objectContaining({ id: initial.id }),
    ])
    expect(collection.get(initial.id)?.name).toBe(`After`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * A direct write is local to its Collection until a provider result says
   * otherwise. Two Collections may own one physical Query, but that shared
   * cache cannot carry A's accepted local row into B. The reference has one
   * server row and two Collection row sets: writing A changes only A. Compare
   * both public rows and the shared cache immediately after the write, before
   * any newer provider result can legitimately update B.
   */
  it.each(
    ([`update`, `delete`, `upsert`] as const).flatMap((operation) =>
      ([`A-first`, `B-first`] as const).map((loadOrder) => ({
        operation,
        loadOrder,
      })),
    ),
  )(
    `keeps a $operation out of another Collection sharing its Query ($loadOrder)`,
    async ({ operation, loadOrder }) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-direct-write-isolation`]
      const server = { id: `x`, name: `Server` }
      const queryFn = vi.fn(() => Promise.resolve([{ ...server }]))
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
      const ownerA = makeCollection(`shared-direct-write-owner-a`)
      const ownerB = makeCollection(`shared-direct-write-owner-b`)
      cleanups.push(async () => {
        await ownerA.cleanup()
        await ownerB.cleanup()
        queryClient.clear()
      })

      const first = loadOrder === `A-first` ? ownerA : ownerB
      const second = loadOrder === `A-first` ? ownerB : ownerA
      await first._sync.loadSubset({})
      await second._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledTimes(1)
      if (operation === `delete`) await ownerA.utils.writeDelete(server.id)
      else if (operation === `upsert`)
        await ownerA.utils.writeUpsert({ id: server.id, name: `Manual` })
      else await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
      expect(ownerA.get(server.id)?.name).toBe(
        operation === `delete` ? undefined : `Manual`,
      )
      expect(ownerB.get(server.id)?.name).toBe(`Server`)
      expect(queryClient.getQueryData(queryKey)).toEqual([server])
      expect(queryFn).toHaveBeenCalledTimes(1)
    },
  )

  /**
   * Eager Collections project one shared Query cache. A direct cache write
   * changes that projection for both Collections without starting a request.
   * The independent reference applies each write to the shared row set, then
   * compares both public Collections and the Query cache at write settlement.
   */
  it.each([`update`, `delete`, `upsert`] as const)(
    `projects an eager $0 through a Query shared by two Collections`,
    async (operation) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-eager-direct-${operation}`]
      const server = { id: `x`, name: `Server` }
      const queryFn = vi.fn(() => Promise.resolve([server]))
      const makeCollection = (suffix: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `shared-eager-direct-${operation}-${suffix}`,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `eager`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`)
      const b = makeCollection(`b`)
      cleanups.push(async () => {
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await Promise.all([a.preload(), b.preload()])
      expect(queryFn).toHaveBeenCalledOnce()
      if (operation === `delete`) await a.utils.writeDelete(server.id)
      else if (operation === `upsert`)
        await a.utils.writeUpsert({ id: server.id, name: `Manual` })
      else await a.utils.writeUpdate({ id: server.id, name: `Manual` })
      expect(a.get(server.id)?.name).toBe(
        operation === `delete` ? undefined : `Manual`,
      )
      expect(b.get(server.id)?.name).toBe(
        operation === `delete` ? undefined : `Manual`,
      )
      expect(queryClient.getQueryData(queryKey)).toEqual(
        operation === `delete` ? [] : [{ id: server.id, name: `Manual` }],
      )
      expect(queryFn).toHaveBeenCalledOnce()
    },
  )

  /**
   * A new direct key joins the shared eager cache and both projections. A
   * later complete server response that omits the key retires it in both.
   */
  it(`projects an eager new-key insert until a later complete fetch`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-eager-new-key`]
    const server = { id: `x`, name: `Server` }
    const queryFn = vi.fn(() => Promise.resolve([server]))
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `shared-eager-new-key-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const b = makeCollection(`b`)
    cleanups.push(async () => {
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await Promise.all([a.preload(), b.preload()])
    expect(queryFn).toHaveBeenCalledOnce()
    await a.utils.writeInsert({ id: `y`, name: `Manual` })
    expect(a.get(`y`)?.name).toBe(`Manual`)
    expect(b.get(`y`)?.name).toBe(`Manual`)
    expect(queryClient.getQueryData(queryKey)).toEqual([
      server,
      { id: `y`, name: `Manual` },
    ])
    expect(queryFn).toHaveBeenCalledOnce()

    await b.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(a.has(`y`)).toBe(false)
    expect(b.has(`y`)).toBe(false)
    expect(a.get(`x`)?.name).toBe(server.name)
    expect(b.get(`x`)?.name).toBe(server.name)
  })

  /**
   * A shared eager cache projects A's direct write to both Collections. The
   * older request must not undo that accepted value in either projection;
   * a later-started complete fetch can replace it in both.
   */
  it(`preserves an eager direct write across an older shared fetch`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-eager-older-fetch`]
    const server = { id: `x`, name: `Server` }
    const older = { id: `x`, name: `Older` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const started = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => {
        started.resolve()
        return held.promise
      })
      .mockResolvedValue([newer])
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `shared-eager-older-fetch-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const b = makeCollection(`b`)
    cleanups.push(async () => {
      held.resolve([older])
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await Promise.all([a.preload(), b.preload()])
    const refetch = b.utils.refetch({ throwOnError: true })
    await started.promise
    await a.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(a.get(server.id)?.name).toBe(`Manual`)
    expect(b.get(server.id)?.name).toBe(`Manual`)
    held.resolve([older])
    await refetch
    expect(a.get(server.id)?.name).toBe(`Manual`)
    expect(b.get(server.id)?.name).toBe(`Manual`)

    await b.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(a.get(server.id)?.name).toBe(newer.name)
    expect(b.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * A later eager Collection projects the shared cache's direct edit without
   * requiring a new fetch. A subsequent explicit fetch replaces that cached
   * value in both Collections. The reference keeps cache projection separate
   * from server freshness and compares both rows and request count.
   */
  it(`projects an eager cache patch on later acquisition`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`late-eager-direct-patch`]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `late-eager-direct-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    cleanups.push(async () => {
      held.resolve([newer])
      await a.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await a.preload()
    await a.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    peer.collection = makeCollection(`b`)
    const b = peer.collection
    await b.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    expect(b.get(server.id)?.name).toBe(`Manual`)
    expect(a.get(server.id)?.name).toBe(`Manual`)
    const refetch = b.utils.refetch({ throwOnError: true })
    await requestStarted.promise
    expect(b.get(server.id)?.name).toBe(`Manual`)
    held.resolve([newer])
    await refetch
    expect(b.get(server.id)?.name).toBe(newer.name)
    expect(a.get(server.id)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A disabled Query never starts its own request. Eager B can project the
   * shared cache edit immediately; on-demand B still waits for server
   * authority under its separate subset ownership law, including after an
   * outside setQueryData edit. Explicit refetch remains available in both
   * modes and later replaces the cached value.
   */
  it.each([
    { syncMode: `eager`, externalCacheEdit: false },
    { syncMode: `on-demand`, externalCacheEdit: false },
    { syncMode: `on-demand`, externalCacheEdit: true },
  ] as const)(
    `respects disabled $syncMode acquisition of a shared Query with external cache edit=$externalCacheEdit`,
    async ({ syncMode, externalCacheEdit }) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`disabled-late-peer-${syncMode}-${externalCacheEdit}`]
      const server = { id: `x`, name: `Server` }
      const newer = { id: `x`, name: `Newer` }
      const held = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([server])
        .mockImplementationOnce(() => held.promise)
      const makeCollection = (suffix: string, enabled: boolean) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `disabled-late-peer-${syncMode}-${suffix}`,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode,
            enabled,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`, true)
      const peer: { collection?: ReturnType<typeof makeCollection> } = {}
      cleanups.push(async () => {
        held.resolve([newer])
        await a.cleanup()
        await peer.collection?.cleanup()
        queryClient.clear()
      })

      if (syncMode === `eager`) await a.preload()
      else await a._sync.loadSubset({})
      await a.utils.writeUpdate({ id: server.id, name: `Manual` })
      if (externalCacheEdit)
        queryClient.setQueryData(queryKey, [{ ...server, name: `Manual` }])
      peer.collection = makeCollection(`b`, false)
      const b = peer.collection
      const load =
        syncMode === `eager`
          ? b.preload()
          : Promise.resolve(b._sync.loadSubset({}))
      let loadState: `pending` | `fulfilled` | `rejected` = `pending`
      void load.then(
        () => (loadState = `fulfilled`),
        () => (loadState = `rejected`),
      )
      for (let turn = 0; turn < 4; turn++) await Promise.resolve()
      expect(queryFn).toHaveBeenCalledOnce()
      expect(b.get(server.id)?.name).toBe(
        syncMode === `eager` ? `Manual` : undefined,
      )
      expect(loadState).toBe(syncMode === `eager` ? `fulfilled` : `pending`)

      const refetch = b.utils.refetch({ throwOnError: true })
      held.resolve([newer])
      await Promise.all([load, refetch])
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(b.get(server.id)?.name).toBe(newer.name)
      expect(a.get(server.id)?.name).toBe(newer.name)
    },
  )

  /**
   * An eager direct write can seed an idle shared Query before any provider
   * fetch. A disabled B projects that seed without starting a request. The
   * next explicit refetch can replace it with the server row.
   */
  it(`projects an eager direct cache seed to a disabled peer`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`disabled-eager-seed-peer`]
    const direct = { id: `x`, name: `Manual` }
    const server = { id: `x`, name: `Server` }
    const held = createDeferred<Array<Row>>()
    const queryFn = vi.fn(() => held.promise)
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `disabled-eager-seed-peer-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          enabled: false,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    cleanups.push(async () => {
      held.resolve([server])
      await a.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await a.utils.writeInsert(direct)
    expect(a.get(direct.id)?.name).toBe(direct.name)
    expect(queryClient.getQueryData(queryKey)).toEqual([direct])
    peer.collection = makeCollection(`b`)
    const b = peer.collection
    const load = b.preload()
    for (let turn = 0; turn < 4; turn++) await Promise.resolve()
    expect(queryFn).not.toHaveBeenCalled()
    await load
    expect(b.get(direct.id)?.name).toBe(direct.name)

    const refetch = b.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledOnce()
    held.resolve([server])
    await refetch
    expect(b.get(direct.id)?.name).toBe(server.name)
    expect(a.get(direct.id)?.name).toBe(server.name)
  })

  /**
   * An eager Query is one keyed cache document projected by both Collections.
   * A direct write changes its authored key in that document; a peer's later
   * direct write changes only its own authored key, even if that peer has not
   * yet applied the first cache notification. The independent reference folds
   * A's write then B's write over the two server rows. Holding B's result
   * application keeps its accepted rows stale at B's write, distinguishing a
   * surgical cache edit from replacing the cache with B's whole row snapshot.
   * The same-key neighbor requires the later accepted write to win. Compare
   * the shared cache and unblocked A projection after B's accepted write, while
   * B's result application remains held. Neither write starts a request.
   */
  it.each([`disjoint`, `same-key`] as const)(
    `composes $0 eager direct writes through one shared Query`,
    async (writeOrder) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-eager-write-composition`, writeOrder]
      const server = [
        { id: `x`, name: `Server X` },
        { id: `y`, name: `Server Y` },
      ]
      const queryFn = vi.fn(() => Promise.resolve(server))
      const makeCollection = (suffix: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `shared-eager-write-composition-${writeOrder}-${suffix}`,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `eager`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`)
      const b = makeCollection(`b`)
      const barrier = createDeferred<void>()
      cleanups.push(async () => {
        b.deferDataRefresh = null
        barrier.resolve()
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await Promise.all([a.preload(), b.preload()])
      expect(queryFn).toHaveBeenCalledOnce()
      b.deferDataRefresh = barrier.promise
      await a.utils.writeUpdate({ id: `x`, name: `A` })
      expect(b.get(`x`)?.name).toBe(`Server X`)
      const bKey = writeOrder === `disjoint` ? `y` : `x`
      await b.utils.writeUpdate({ id: bKey, name: `B` })
      expect(b.get(bKey)?.name).toBe(`B`)
      if (writeOrder === `disjoint`) expect(b.get(`x`)?.name).toBe(`Server X`)

      const expected = [
        { id: `x`, name: writeOrder === `disjoint` ? `A` : `B` },
        { id: `y`, name: writeOrder === `disjoint` ? `B` : `Server Y` },
      ]
      expect(queryClient.getQueryData(queryKey)).toEqual(expected)
      expect(queryFn).toHaveBeenCalledOnce()
      await vi.waitFor(() => {
        expect([a.get(`x`)?.name, a.get(`y`)?.name]).toEqual(
          expected.map((row) => row.name),
        )
      })
      expect(queryFn).toHaveBeenCalledOnce()
    },
  )

  /**
   * Directly selected response arrays carry the same shared-Query law as raw
   * arrays. The response envelope is part of the cache contract, while each
   * Collection's accepted rows can lag behind a held notification. Folding
   * two disjoint writes over the response checks both row composition and
   * preservation of unrelated envelope metadata without a provider request.
   */
  it(`composes eager peer writes inside a selected response array`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-eager-wrapped-composition`]
    const server = [
      { id: `x`, name: `Server X` },
      { id: `y`, name: `Server Y` },
    ]
    const queryFn = vi.fn(() => Promise.resolve({ items: server, tag: `keep` }))
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey,
          queryFn,
          select: (response) => response.items,
          getKey: (row: Row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`shared-eager-wrapped-a`)
    const b = makeCollection(`shared-eager-wrapped-b`)
    const barrier = createDeferred<void>()
    cleanups.push(async () => {
      b.deferDataRefresh = null
      barrier.resolve()
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await Promise.all([a.preload(), b.preload()])
    b.deferDataRefresh = barrier.promise
    await a.utils.writeUpdate({ id: `x`, name: `A` })
    await b.utils.writeUpdate({ id: `y`, name: `B` })
    const expected = [
      { id: `x`, name: `A` },
      { id: `y`, name: `B` },
    ]
    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: expected,
      tag: `keep`,
    })
    await vi.waitFor(() => {
      expect([a.get(`x`)?.name, a.get(`y`)?.name]).toEqual([`A`, `B`])
    })
    expect(queryFn).toHaveBeenCalledOnce()
  })

  /**
   * B owns a shared on-demand Query while A has no subset owner. The Query
   * Collection guide's on-demand cache rule protects another Collection's
   * owned Query: A's direct insert changes only A's accepted row and starts
   * no provider request. A later physical fetch may replace that row when A
   * acquires the cached result, as the guide's shared-key rule permits.
   *
   * The reference is the authored server row, A-only insert, and newer server
   * row in that order. The first public-row and cache checkpoint rejects a
   * shared-cache guard that runs only when the writing Collection owns a row.
   * The final checkpoint distinguishes that guard from a rule that refuses
   * all later server authority.
   */
  it(`keeps an unacquired direct insert out of another Collection's shared Query`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-unacquired-direct-insert`]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockResolvedValue([newer])
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
    const ownerA = makeCollection(`shared-unacquired-insert-a`)
    const ownerB = makeCollection(`shared-unacquired-insert-b`)
    cleanups.push(async () => {
      await ownerA.cleanup()
      await ownerB.cleanup()
      queryClient.clear()
    })

    await ownerB._sync.loadSubset({})
    expect(ownerB.get(server.id)?.name).toBe(server.name)
    expect(ownerA.has(server.id)).toBe(false)
    await ownerA.utils.writeInsert({ id: server.id, name: `Manual` })
    expect(ownerA.get(server.id)?.name).toBe(`Manual`)
    expect(ownerB.get(server.id)?.name).toBe(server.name)
    expect(queryClient.getQueryData(queryKey)).toEqual([server])
    expect(queryFn).toHaveBeenCalledOnce()

    await ownerB.utils.refetch({ throwOnError: true })
    expect(ownerA.get(server.id)?.name).toBe(`Manual`)
    expect(ownerB.get(server.id)?.name).toBe(newer.name)
    await ownerA._sync.loadSubset({})
    expect(ownerA.get(server.id)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A Collection that acquires a Query after another Collection's direct
   * cache patch must not mistake that local edit for a server result. The
   * reference starts with one server row, then gives only A the direct update.
   * B's first acquisition may request a new result; while that request is
   * held, B has no server-confirmed copy of A's value. A post-write result
   * may then replace A's write in both Collections. Constructing B before or
   * after the write varies registration without changing this authority law.
   * The driver checks public rows, cache data, and provider calls at each cut.
   */
  it.each([`registered`, `later-created`] as const)(
    `does not adopt another Collection's cached direct edit on later acquisition: %s`,
    async (peerTiming) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`late-shared-direct-edit-${peerTiming}`]
      const server = { id: `x`, name: `Server` }
      const newer = { id: `x`, name: `Newer` }
      const held = createDeferred<Array<Row>>()
      const requestStarted = createDeferred<void>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([server])
        .mockImplementationOnce(() => {
          requestStarted.resolve()
          return held.promise
        })
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
      const ownerA = makeCollection(`late-shared-a-${peerTiming}`)
      let ownerB =
        peerTiming === `registered`
          ? makeCollection(`late-shared-b-${peerTiming}`)
          : undefined
      cleanups.push(async () => {
        held.resolve([newer])
        await ownerA.cleanup()
        await ownerB?.cleanup()
        queryClient.clear()
      })

      await ownerA._sync.loadSubset({})
      expect(ownerA.get(server.id)?.name).toBe(server.name)
      await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
      expect(ownerA.get(server.id)?.name).toBe(`Manual`)
      expect(queryClient.getQueryData(queryKey)).toEqual([
        { id: server.id, name: `Manual` },
      ])
      expect(queryFn).toHaveBeenCalledOnce()

      ownerB ??= makeCollection(`late-shared-b-${peerTiming}`)
      const load = Promise.resolve(ownerB._sync.loadSubset({}))
      void load.catch(() => undefined)
      const first = await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ])
      expect(first).toBe(`request-started`)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(ownerB.has(server.id)).toBe(false)
      held.resolve([newer])
      await load
      expect(ownerB.get(server.id)?.name).toBe(newer.name)
      expect(ownerA.get(server.id)?.name).toBe(newer.name)
    },
  )

  /**
   * Query Core may assign a Collection key the physical Query created for a
   * different stored key when a custom hash aliases them. The cache is the
   * source of that Query's rows; a direct write to a different row cannot
   * evict the foreign stored key or turn its old row into a fresh fetch. The
   * reference keeps the ownerless direct y across subset release and keeps
   * the foreign physical Query. Its cached x has not been verified by a
   * physical fetch for this Collection, so disabled reacquisition waits until
   * an explicit refetch returns the server row. This distinguishes retaining
   * the cache entry from incorrectly treating it as fresh authority.
   */
  it(`retains a foreign stored key under a custom Query hash after a direct write`, async () => {
    type Row = { id: string; name: string }
    const foreignKey = [`foreign-stored-key`]
    const baseKey = [`collection-stored-key`]
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryKeyHashFn: () => `shared-hash`,
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
        },
      },
    })
    queryClient.setQueryData(foreignKey, [{ id: `x`, name: `Cached` }])
    const physicalQuery = queryClient.getQueryCache().getAll()[0]!
    const queryFn = vi.fn(() => Promise.resolve([{ id: `x`, name: `Server` }]))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id: `foreign-stored-key-collection`,
        queryClient,
        queryKey: () => baseKey,
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        enabled: false,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    const initialRequest = {}
    await collection._sync.loadSubset(initialRequest)
    expect(collection.get(`x`)?.name).toBe(`Cached`)
    await collection.utils.writeInsert({ id: `y`, name: `Manual` })
    collection._sync.unloadSubset(initialRequest)
    const reacquisition = Promise.resolve(collection._sync.loadSubset({}))
    let settled = false
    void reacquisition.then(() => (settled = true))
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    expect(settled).toBe(false)
    expect(collection.get(`y`)?.name).toBe(`Manual`)
    expect(queryClient.getQueryCache().getAll()).toContain(physicalQuery)
    expect(physicalQuery.queryKey).toEqual(foreignKey)
    expect(queryFn).not.toHaveBeenCalled()
    await collection.utils.refetch({ throwOnError: true })
    await reacquisition
    expect(collection.get(`x`)?.name).toBe(`Server`)
    expect(collection.has(`y`)).toBe(false)
    expect(queryFn).toHaveBeenCalledOnce()
  })

  /**
   * A reset may reuse a Query's numeric data-update count. The independent
   * authority rule distinguishes the physical provider result from A's local
   * cache patch: B must ignore the patch while waiting, then apply the new
   * provider row even when reset gives it the patch's old count. The driver
   * observes B's pending load before the result and its settlement afterward.
   */
  it.each([`new-response`, `same-reference`] as const)(
    `settles a shared Query acquisition after reset reuses a cache edit version: %s`,
    async (responseIdentity) => {
      type Row = { id: string; name: string }
      const queryKey = [`shared-reset-cache-version`]
      const queryClient = createQueryClient()
      const replacement = createDeferred<Array<Row>>()
      const abandoned = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `Initial` }])
        .mockImplementationOnce(() => abandoned.promise)
        .mockImplementationOnce(() => replacement.promise)
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
      const a = makeCollection(`shared-reset-a`)
      const b = makeCollection(`shared-reset-b`)
      cleanups.push(async () => {
        abandoned.resolve([])
        replacement.resolve([])
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await a._sync.loadSubset({})
      await a.utils.writeUpdate({ id: `x`, name: `Manual` })
      const query = queryClient.getQueryCache().find({ queryKey, exact: true })!
      const editedCacheData = query.state.data as Array<Row>
      expect(query.state.dataUpdateCount).toBe(1)
      const acquisition = Promise.resolve(b._sync.loadSubset({}))
      void acquisition.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      expect(b.has(`x`)).toBe(false)

      const reset = queryClient.resetQueries({ queryKey, exact: true })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
      const expected =
        responseIdentity === `same-reference`
          ? editedCacheData
          : [{ id: `x`, name: `After reset` }]
      replacement.resolve(expected)
      await reset
      await vi.waitFor(() => expect(b.get(`x`)?.name).toBe(expected[0]?.name))
      await acquisition
      expect(query.state.dataUpdateCount).toBe(1)
    },
  )

  /**
   * Query Core notifies observers before its cache success listener. A direct
   * write made by a foreign observer in that gap is still a local cache edit,
   * not part of the successful provider response. The independent account
   * gives A the direct value and leaves B without a confirmed row until a
   * third physical request settles. The held B request distinguishes fetched
   * response identity from the mutable Query state seen by the cache listener.
   */
  it(`does not certify a reentrant direct cache edit as a fetched result`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`reentrant-success-direct-edit`]
    const server = { id: `x`, name: `Server` }
    const older = { id: `x`, name: `Older` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockResolvedValueOnce([older])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
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
    const a = makeCollection(`reentrant-success-a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    const outside = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      enabled: false,
      notifyOnChangeProps: `all`,
    })
    let directWrite: Promise<unknown> | undefined
    const unsubscribe = outside.subscribe((result) => {
      if (
        result.isSuccess &&
        !result.isFetching &&
        result.data?.[0]?.name === older.name &&
        !directWrite
      ) {
        directWrite = Promise.resolve(
          a.utils.writeUpdate({ id: server.id, name: `Manual` }),
        )
      }
    })
    cleanups.push(async () => {
      held.resolve([newer])
      unsubscribe()
      await a.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await a._sync.loadSubset({})
    await a.utils.refetch({ throwOnError: true })
    await directWrite
    expect(a.get(server.id)?.name).toBe(`Manual`)
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    peer.collection = makeCollection(`reentrant-success-b`)
    const load = Promise.resolve(peer.collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(peer.collection.has(server.id)).toBe(false)
    held.resolve([newer])
    await load
    expect(peer.collection.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * A directly selected response property has the same provenance rule as a
   * raw array. A's direct edit can patch its Query envelope, but a later B
   * cannot treat that envelope as a server fetch. The reference gives B no
   * row until the held replacement response, then gives it the server row.
   * This distinguishes the rule from a patch marker set only for raw arrays.
   */
  it(`withholds a directly selected cache edit from a later Collection`, async () => {
    type Row = { id: string; name: string }
    type Response = { items: Array<Row> }
    const queryClient = createQueryClient()
    const queryKey = [`late-shared-wrapped-direct-edit`]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Response>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ items: [server] })
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey,
          queryFn,
          select: (response: Response) => response.items,
          getKey: (row: Row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const ownerA = makeCollection(`late-wrapped-a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    cleanups.push(async () => {
      held.resolve({ items: [newer] })
      await ownerA.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await ownerA._sync.loadSubset({})
    await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: [{ id: server.id, name: `Manual` }],
    })
    peer.collection = makeCollection(`late-wrapped-b`)
    const ownerB = peer.collection
    const load = Promise.resolve(ownerB._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(ownerB.has(server.id)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(2)
    held.resolve({ items: [newer] })
    await load
    expect(ownerB.get(server.id)?.name).toBe(newer.name)
    expect(ownerA.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * The late peer must withhold A's local cache edit while its replacement
   * fetch runs. If that fetch fails, it still reports the new Query error:
   * withholding an old success cannot suppress a terminal failure. The
   * independent reference has no B-owned row and one failed B request, so the
   * public checkpoint is B's error state and absence of A's direct value.
   * The successful sibling above distinguishes this from withholding every
   * result. Registration on either side of the write is a legal history.
   */
  it.each([`registered`, `later-created`] as const)(
    `reports a failed fetch while withholding another Collection's cached edit: %s`,
    async (peerTiming) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`late-shared-direct-error-${peerTiming}`]
      const failure = new Error(`replacement failed`)
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
        .mockRejectedValueOnce(failure)
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
      const ownerA = makeCollection(`late-error-a-${peerTiming}`)
      let ownerB =
        peerTiming === `registered`
          ? makeCollection(`late-error-b-${peerTiming}`)
          : undefined
      cleanups.push(async () => {
        await ownerA.cleanup()
        await ownerB?.cleanup()
        queryClient.clear()
      })

      await ownerA._sync.loadSubset({})
      await ownerA.utils.writeUpdate({ id: `x`, name: `Manual` })
      ownerB ??= makeCollection(`late-error-b-${peerTiming}`)
      await expect(ownerB._sync.loadSubset({})).rejects.toBe(failure)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(ownerB.has(`x`)).toBe(false)
      expect(ownerB.utils.lastError).toBe(failure)
      expect(ownerB.utils.isError).toBe(true)
      expect(ownerB.utils.errorCount).toBe(1)
      expect(ownerA.get(`x`)?.name).toBe(`Manual`)
    },
  )

  /**
   * A shared request started before A's local write remains a server result
   * for B. A's later accepted value wins only in A. The reference keeps two
   * Collection row sets over the one provider response. B releases and
   * reacquires its subset while the fetch is held. After settlement, B sees
   * the provider row and A sees its direct write. This tests the result-merge
   * and remount paths as well as the immediate cache patch path above.
   */
  it(`keeps an older shared fetch from carrying A's direct write into B`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-older-fetch-isolation`]
    const older = createDeferred<Array<Row>>()
    const server = { id: `x`, name: `Server` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => older.promise)
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
    const ownerA = makeCollection(`shared-older-fetch-a`)
    const ownerB = makeCollection(`shared-older-fetch-b`)
    cleanups.push(async () => {
      older.resolve([server])
      await ownerA.cleanup()
      await ownerB.cleanup()
      queryClient.clear()
    })

    const ownerBRequest = {}
    await Promise.all([
      ownerA._sync.loadSubset({}),
      ownerB._sync.loadSubset(ownerBRequest),
    ])
    const refresh = ownerA.utils.refetch({ throwOnError: true })
    void refresh.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(ownerB.get(server.id)?.name).toBe(`Server`)
    ownerB._sync.unloadSubset(ownerBRequest)
    expect(ownerB.has(server.id)).toBe(false)
    const reacquire = Promise.resolve(ownerB._sync.loadSubset({}))
    void reacquire.catch(() => undefined)
    older.resolve([{ id: server.id, name: `Older` }])
    await Promise.all([refresh, reacquire])
    expect(ownerA.get(server.id)?.name).toBe(`Manual`)
    expect(ownerB.get(server.id)?.name).toBe(`Older`)
  })

  /**
   * An explicit refetch after a direct write needs a post-write provider
   * request, even if another Collection started the shared empty-cache fetch.
   * The independent reference orders provider starts and accepted writes; the
   * physical Query's initiating Collection does not change that order. The
   * two legal start orders distinguish a local fetch clock from a shared one.
   * At refetch settlement, observe request count and A's public row.
   */
  it.each([`A-first`, `B-first`] as const)(
    `starts a post-write refetch of a shared empty-cache Query ($startOrder)`,
    async (startOrder) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-empty-cache-post-write-${startOrder}`]
      const first = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce([])
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
        )
      const a = makeCollection(`shared-refetch-a-${startOrder}`)
      const b = makeCollection(`shared-refetch-b-${startOrder}`)
      cleanups.push(async () => {
        first.resolve([])
        await Promise.all([a.cleanup(), b.cleanup()])
        queryClient.clear()
      })
      const initial = startOrder === `A-first` ? a : b
      const second = startOrder === `A-first` ? b : a
      const firstLoad = Promise.resolve(initial._sync.loadSubset({}))
      void firstLoad.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      const secondLoad = Promise.resolve(second._sync.loadSubset({}))
      void secondLoad.catch(() => undefined)
      await a.utils.writeInsert({ id: `x`, name: `Written` })
      await a.utils.writeDelete(`x`)
      const refetch = a.utils.refetch({ throwOnError: true })
      void refetch.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      first.resolve([{ id: `x`, name: `Stale` }])
      await refetch
      expect(a.has(`x`)).toBe(false)
      await Promise.allSettled([firstLoad, secondLoad])
    },
  )

  /**
   * The neighboring order is different: a shared empty-cache request begun
   * after A's direct write is already post-write authority. A's explicit
   * refetch may join it. The independent request-order reference predicts one
   * provider call and both Collections receiving that result at settlement.
   * This rejects a blanket rule that cancels every shared in-flight request.
   */
  it(`reuses a shared empty-cache request started after the direct write`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-newer-empty-cache-request`]
    const response = createDeferred<Array<Row>>()
    const server = { id: `x`, name: `Server` }
    const queryFn = vi.fn(() => response.promise)
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          startSync: true,
        }),
      )
    const a = makeCollection(`shared-newer-a`)
    const b = makeCollection(`shared-newer-b`)
    cleanups.push(async () => {
      response.resolve([server])
      await Promise.all([a.cleanup(), b.cleanup()])
      queryClient.clear()
    })
    await a.utils.writeInsert({ id: `x`, name: `Written` })
    const bLoad = Promise.resolve(b._sync.loadSubset({}))
    void bLoad.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    const aLoad = Promise.resolve(a._sync.loadSubset({}))
    void aLoad.catch(() => undefined)
    const refetch = a.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    expect(queryFn).toHaveBeenCalledOnce()
    response.resolve([server])
    await Promise.all([aLoad, bLoad, refetch])
    expect(queryFn).toHaveBeenCalledOnce()
    expect(a.get(`x`)?.name).toBe(`Server`)
    expect(b.get(`x`)?.name).toBe(`Server`)
  })

  /**
   * A's sync restart cannot move an already-running physical Query request
   * past its earlier direct write. The reference order is B's request start,
   * A's accepted insert/delete, A's sync restart, then A's explicit refetch.
   * A post-write request must start and settle without reviving x. This is
   * the same request-order law as the two-Collection histories above, with
   * one added sync-run boundary.
   */
  it.each([false, true] as const)(
    `keeps a shared pre-write fetch older across Collection sync restart with explicit refetch=%s`,
    async (explicitRefetch) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-fetch-across-sync-restart`, explicitRefetch]
      const first = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue([])
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
        )
      const a = makeCollection(`shared-fetch-restart-a`)
      const b = makeCollection(`shared-fetch-restart-b`)
      cleanups.push(async () => {
        first.resolve([])
        await Promise.all([a.cleanup(), b.cleanup()])
        queryClient.clear()
      })
      const bLoad = Promise.resolve(b._sync.loadSubset({}))
      void bLoad.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      await a.utils.writeInsert({ id: `x`, name: `Written` })
      await a.utils.writeDelete(`x`)
      await a.cleanup()
      const subscription = a.subscribeChanges(() => {})
      cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
      const aLoad = Promise.resolve(a._sync.loadSubset({}))
      void aLoad.catch(() => undefined)
      const refetch = explicitRefetch
        ? a.utils.refetch({ throwOnError: true })
        : undefined
      void refetch?.catch(() => undefined)
      if (explicitRefetch)
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      first.resolve([{ id: `x`, name: `Stale` }])
      await refetch
      await aLoad
      expect(a.has(`x`)).toBe(false)
      await Promise.allSettled([aLoad, bLoad])
    },
  )

  /**
   * Cleanup ends one sync run and discards its memory-only direct rows. A
   * direct-row position from that run cannot veto a valid cached Query row
   * when the same Collection starts a new run. The independent reference has
   * one server row, one optional accepted direct row, and a run boundary that
   * removes the direct row. B retains the physical Query throughout.
   *
   * Both histories insert directly; one explicitly deletes before cleanup.
   * The real QueryClient and public Collection are checked after restart and
   * cached acquisition. One provider call proves the cached path was used.
   */
  it.each([false, true] as const)(
    `does not carry an old direct-row position into a restarted sync run, deleted=%s`,
    async (deleteBeforeCleanup) => {
      type Row = { id: string; name: string }
      const id = `direct-position-restart-${deleteBeforeCleanup}`
      const queryClient = createQueryClient()
      const queryKey = [id]
      const server = { id: `x`, name: `Server` }
      const queryFn = vi.fn(() => Promise.resolve([server]))
      const makeCollection = (name: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: name,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`${id}-a`)
      const b = makeCollection(`${id}-b`)
      cleanups.push(async () => {
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })
      await b._sync.loadSubset({})
      expect(b.get(`x`)?.name).toBe(server.name)
      await a.utils.writeInsert({ id: `x`, name: `Direct` })
      expect(a.get(`x`)?.name).toBe(`Direct`)
      if (deleteBeforeCleanup) await a.utils.writeDelete(`x`)
      await a.cleanup()

      const subscription = a.subscribeChanges(() => {})
      cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
      await a._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledOnce()
      expect(a.get(`x`)?.name).toBe(server.name)
      expect(b.get(`x`)?.name).toBe(server.name)
    },
  )

  /**
   * A direct cache patch belongs to the sync run that accepted it. An outside
   * Query observer can retain that physical cache through A's cleanup, but
   * A's next run cannot treat its own old local edit as a fetched result.
   * The independent reference discards A's memory-only row at cleanup and
   * waits for a new server response. The held-request cut rejects a cache
   * provenance rule that compares Collection identity but ignores sync run.
   */
  it(`does not replay its own direct cache patch after sync restart`, async () => {
    type Row = { id: string; name: string }
    const id = `direct-cache-patch-restart`
    const queryClient = createQueryClient()
    const queryKey = [id]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const collection = createCollection(
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
    const outside = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      enabled: false,
      staleTime: Infinity,
    })
    const unsubscribeOutside = outside.subscribe(() => {})
    cleanups.push(async () => {
      held.resolve([newer])
      unsubscribeOutside()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    await collection.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    await collection.cleanup()
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    const subscription = collection.subscribeChanges(() => {})
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    const load = Promise.resolve(collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(collection.has(server.id)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(2)
    held.resolve([newer])
    await load
    expect(collection.get(server.id)?.name).toBe(newer.name)
  })

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
    async ({ order, laterWrite, cacheEdit, finalRefetch }) => {
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
        queryClient.setQueryData(queryKey, [
          { id: `x`, name: `Local cache edit` },
        ])
        reference.cacheStillFetched = false
      }
      if (finalRefetch) await fetchB(false)
      const callsBeforeAcquisition = queryFn.mock.calls.length
      const request = {}
      await a._sync.loadSubset(request)
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
      a._sync.unloadSubset(request)
      expect(a.get(`x`)?.name).toBe(
        remoteMayReplace ? undefined : directX.value,
      )
    },
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
    async ({ existingOwner, settleNewerFirst, directWrite, sameValue }) => {
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
        toBooleanPredicate(
          compileSingleRowExpression(olderSubset.where)(initial),
        ),
      ).toBe(true)
      expect(
        toBooleanPredicate(
          compileSingleRowExpression(olderSubset.where)(olderRow),
        ),
      ).toBe(true)
      expect(
        toBooleanPredicate(
          compileSingleRowExpression(newerSubset.where)(newerRow),
        ),
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
      const olderRefetchSubset = existingOwner
        ? { ...olderSubset, refetch: true }
        : olderSubset
      const olderStart = start()
      const olderLoad = collection._sync.loadSubset(olderRefetchSubset)
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
      expect(
        queryClient.getQueryCache().findAll({ queryKey: [id] }),
      ).toHaveLength(2)
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
          collection._sync.unloadSubset(olderRefetchSubset)
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
    },
  )

  /**
   * Fetch order is the order of provider invocation. Query Core can accept a
   * fetch while offline and defer its queryFn until after a direct write. The
   * reference order is initial source, direct write, then fetched source, so
   * the fetched row is latest even though Query Core accepted work earlier.
   * The real QueryClient pauses the request; public rows and the cache are
   * compared after the write and after that provider result applies.
   */
  it(`orders a paused fetch after a direct write when its provider starts later`, async () => {
    type Row = { id: string; name: string }
    const id = `paused-fetch-after-direct-write`
    const queryClient = createQueryClient()
    queryClient.mount()
    const held = createDeferred<Array<Row>>()
    const queryFn = vi
      .fn<() => Promise<Array<Row>>>()
      .mockResolvedValueOnce([{ id: `x`, name: `initial` }])
      .mockImplementationOnce(() => held.promise)
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        retry: false,
      }),
    )
    const demand = {}
    const pending: { refetch?: Promise<unknown> } = {}
    cleanups.push(async () => {
      onlineManager.setOnline(true)
      held.resolve([{ id: `x`, name: `fetched` }])
      await Promise.allSettled([pending.refetch])
      collection._sync.unloadSubset(demand)
      await collection.cleanup()
      queryClient.unmount()
      queryClient.clear()
    })

    await collection._sync.loadSubset(demand)
    onlineManager.setOnline(false)
    pending.refetch = collection.utils.refetch({ throwOnError: true })
    await vi.waitFor(() =>
      expect(queryClient.getQueryState([id])?.fetchStatus).toBe(`paused`),
    )
    expect(queryFn).toHaveBeenCalledOnce()
    await collection.utils.writeUpdate({ id: `x`, name: `local` })
    expect(collection.get(`x`)?.name).toBe(`local`)

    onlineManager.setOnline(true)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    held.resolve([{ id: `x`, name: `fetched` }])
    await pending.refetch
    expect({
      cache: queryClient.getQueryData([id]),
      publicRow: collection.get(`x`)?.name,
    }).toEqual({
      cache: [{ id: `x`, name: `fetched` }],
      publicRow: `fetched`,
    })
  })

  /**
   * A Query Core behavior can complete a fetch without calling queryFn. For an
   * infinite Query with no next page, its old cached page is not a new source
   * answer and cannot supersede a later accepted direct write. The model has
   * an initial source row, a direct write, and no later source invocation; it
   * therefore keeps the direct row. The real InfiniteQueryObserver drives the
   * no-next-page path, and the public Collection row is checked after it
   * settles. This currently fails because the cache success action carries
   * no indication that no query function ran. See
   * https://github.com/TanStack/db/issues/2176.
   */
  it.fails(
    `keeps a direct row when an infinite query has no next page`,
    async () => {
      type Row = { id: string; name: string }
      const id = `infinite-no-next-page-direct-write`
      const queryClient = createQueryClient()
      const initial = { id: `x`, name: `initial` }
      const cached = { pages: [[initial]], pageParams: [0] }
      queryClient.setQueryData([id], cached)
      const collectionQueryFn = vi.fn(() => Promise.resolve(cached))
      const collection = createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey: [id],
          queryFn: collectionQueryFn,
          select: (response: typeof cached) => response.pages.flat(),
          getKey: (row: Row) => row.id,
          syncMode: `on-demand`,
          startSync: true,
        }),
      )
      const demand = {}
      const publications: Array<string> = []
      const subscription = collection.subscribeChanges(
        (batch) => {
          for (const change of batch) {
            if (change.key === `x`) publications.push(change.value.name)
          }
        },
        { includeInitialState: false },
      )
      await collection._sync.loadSubset(demand)
      const outsideQueryFn = vi.fn(() => Promise.resolve([initial]))
      const outside = new InfiniteQueryObserver(queryClient, {
        queryKey: [id],
        queryFn: outsideQueryFn,
        initialPageParam: 0,
        getNextPageParam: () => undefined,
        enabled: false,
        staleTime: Infinity,
      })
      const releaseOutside = outside.subscribe(() => {})
      cleanups.push(async () => {
        releaseOutside()
        subscription.unsubscribe()
        collection._sync.unloadSubset(demand)
        await collection.cleanup()
        queryClient.clear()
      })

      await collection.utils.writeUpdate({ id: `x`, name: `local` })
      expect({ row: collection.get(`x`)?.name, publications }).toEqual({
        row: `local`,
        publications: [`initial`, `local`],
      })
      await outside.fetchNextPage()
      expect(outsideQueryFn).not.toHaveBeenCalled()
      expect(collectionQueryFn).not.toHaveBeenCalled()
      expect({ row: collection.get(`x`)?.name, publications }).toEqual({
        row: `local`,
        publications: [`initial`, `local`],
      })
    },
  )

  /**
   * A custom Query persister can invoke queryFn speculatively and return an
   * unrelated older cache value. The model accepts the direct write after the
   * initial source row; the speculative invocation supplies no accepted source
   * result, so the direct row remains latest. QueryClient defaults install the
   * real persister, and the public Collection row is checked after its refetch
   * settles. Query Core's success action does not identify which value won.
   * See https://github.com/TanStack/db/issues/2176.
   */
  it.fails(
    `keeps a direct row when a persister discards a speculative source result`,
    async () => {
      type Row = { id: string; name: string }
      const id = `speculative-persister-direct-write`
      const queryClient = createQueryClient()
      const staleCache: Array<Row> = [{ id: `x`, name: `stale-cache` }]
      const queryFn = vi
        .fn<() => Promise<Array<Row>>>()
        .mockResolvedValueOnce([{ id: `x`, name: `initial` }])
        .mockResolvedValueOnce([{ id: `x`, name: `fresh-source` }])
      let fetches = 0
      queryClient.setQueryDefaults([id], {
        persister: (runSource, context) => {
          fetches++
          if (fetches === 1) return runSource(context)
          void runSource(context)
          return Promise.resolve(staleCache)
        },
      })
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          startSync: true,
          retry: false,
        }),
      )
      const publications: Array<string> = []
      const subscription = collection.subscribeChanges(
        (batch) => {
          for (const change of batch) {
            if (change.key === `x`) publications.push(change.value.name)
          }
        },
        { includeInitialState: false },
      )
      cleanups.push(async () => {
        subscription.unsubscribe()
        await collection.cleanup()
        queryClient.clear()
      })

      await collection.preload()
      await collection.utils.writeUpdate({ id: `x`, name: `local` })
      expect({ row: collection.get(`x`)?.name, publications }).toEqual({
        row: `local`,
        publications: [`initial`, `local`],
      })

      const refetched = await collection.utils.refetch({ throwOnError: true })
      expect(refetched[0]?.isSuccess).toBe(true)
      expect(fetches).toBe(2)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect({ row: collection.get(`x`)?.name, publications }).toEqual({
        row: `local`,
        publications: [`initial`, `local`],
      })
    },
  )

  /**
   * A retry belongs to its first source invocation. F1 first invokes its
   * provider and fails while focus is lost; Query Core holds its retry. F2
   * then supplies x through a different legal subset. When focus returns,
   * F1's stale retry may complete its own Query, but cannot take a new row
   * position and replace F2's continuously owned public row. The independent
   * model is just the invocation order F1, F2, F1 retry: F2 is latest. Real
   * Query Core retries and Collection application form the receiving path;
   * compare public and F2 cache rows after both demand promises settle.
   */
  it(`keeps a later overlapping source row when an older fetch retries`, async () => {
    type Row = { id: string; category: string; name: string }
    const id = `overlapping-retry-source-order`
    const queryClient = createQueryClient()
    queryClient.mount()
    const fresh: Row = { id: `x`, category: `a`, name: `F2` }
    const stale: Row = { id: `x`, category: `a`, name: `F1 retry` }
    const invokedKeys: Array<string> = []
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      invokedKeys.push(hashKey(context.queryKey))
      if (invokedKeys.length === 1) {
        focusManager.setFocused(false)
        return Promise.reject(new Error(`F1 first attempt failed`))
      }
      return Promise.resolve([invokedKeys.length === 2 ? fresh : stale])
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        networkMode: `always`,
        retry: 1,
        retryDelay: 0,
      }),
    )
    const a = { where: eq(new IR.PropRef([`category`]), `a`) }
    const b = { where: eq(new IR.PropRef([`id`]), `x`) }
    const aLoad = Promise.resolve(collection._sync.loadSubset(a))
    void aLoad.catch(() => undefined)
    cleanups.push(async () => {
      focusManager.setFocused(true)
      await Promise.allSettled([aLoad])
      collection._sync.unloadSubset(a)
      collection._sync.unloadSubset(b)
      await collection.cleanup()
      queryClient.unmount()
      focusManager.setFocused(undefined)
      queryClient.clear()
    })

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    const firstQuery = queryClient
      .getQueryCache()
      .findAll({ queryKey: [id] })[0]!
    await vi.waitFor(() => expect(firstQuery.state.fetchStatus).toBe(`paused`))
    await collection._sync.loadSubset(b)
    expect(invokedKeys).toHaveLength(2)
    expect(invokedKeys[0]).not.toBe(invokedKeys[1])
    expect(collection.get(`x`)?.name).toBe(`F2`)
    const secondQuery = queryClient
      .getQueryCache()
      .findAll({ queryKey: [id] })
      .find((query) => query.queryHash === invokedKeys[1])!

    focusManager.setFocused(true)
    await aLoad
    expect(invokedKeys).toEqual([
      invokedKeys[0],
      invokedKeys[1],
      invokedKeys[0],
    ])
    expect({
      publicRow: collection.get(`x`)?.name,
      f2Cache: (secondQuery.state.data as Array<Row>)[0]?.name,
    }).toEqual({ publicRow: `F2`, f2Cache: `F2` })
  })

  /**
   * Canceling a failed, pending retry starts a new physical fetch. It has a
   * later source position than an overlapping Query that completed while the
   * old retry was paused. Query Core emits a new fetch action in this path.
   * The model orders the provider invocations F1, B, F2 and assigns F2's
   * result the latest value. The public row after F2 settles is the check.
   */
  it(`lets a replacement of a paused retry supersede an overlapping source row`, async () => {
    type Row = { id: string; category: string; name: string }
    const id = `overlapping-paused-retry-replacement`
    const queryClient = createQueryClient()
    queryClient.mount()
    const fetchActions: Array<object> = []
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === `updated` && event.action.type === `fetch`)
        fetchActions.push(event.query)
    })
    const providerRows = {
      seed: { id: `x`, category: `a`, name: `seed` },
      b: { id: `x`, category: `a`, name: `B` },
      replacement: { id: `x`, category: `a`, name: `F2` },
    }
    let calls = 0
    const queryFn = vi.fn(() => {
      calls++
      if (calls === 1) return Promise.resolve([providerRows.seed])
      if (calls === 2) {
        focusManager.setFocused(false)
        return Promise.reject(new Error(`paused retry`))
      }
      return Promise.resolve([
        calls === 3 ? providerRows.b : providerRows.replacement,
      ])
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        networkMode: `always`,
        retry: 1,
        retryDelay: 0,
      }),
    )
    const a = { where: eq(new IR.PropRef([`category`]), `a`) }
    const b = { where: eq(new IR.PropRef([`id`]), `x`) }
    cleanups.push(async () => {
      focusManager.setFocused(true)
      collection._sync.unloadSubset(a)
      collection._sync.unloadSubset(b)
      await collection.cleanup()
      queryClient.unmount()
      unsubscribeCache()
      focusManager.setFocused(undefined)
      queryClient.clear()
    })

    await collection._sync.loadSubset(a)
    const firstQuery = queryClient
      .getQueryCache()
      .findAll({ queryKey: [id] })[0]!
    const firstRefetch = queryClient.refetchQueries({
      queryKey: firstQuery.queryKey,
      exact: true,
    })
    await vi.waitFor(() => expect(firstQuery.state.fetchStatus).toBe(`paused`))
    await collection._sync.loadSubset(b)
    expect(collection.get(`x`)?.name).toBe(`B`)
    const firstQueryFetchActions = fetchActions.filter(
      (query) => query === firstQuery,
    ).length

    const replacement = queryClient.refetchQueries({
      queryKey: firstQuery.queryKey,
      exact: true,
    })
    await replacement
    await firstRefetch
    expect(calls).toBe(4)
    expect(fetchActions.filter((query) => query === firstQuery)).toHaveLength(
      firstQueryFetchActions + 1,
    )
    expect(collection.get(`x`)?.name).toBe(`F2`)
  })

  /**
   * Query Core can notify cache listeners after accepting A's fetch but
   * before invoking A's query function. A listener then starts B, whose query
   * function runs first. The source-order model assigns B the earlier value
   * position and A the later one. Both results still claim their own subset;
   * after A applies and B settles last, the public row keeps A's value. This
   * checkpoint distinguishes query-function start from fetch-call acceptance.
   */
  it.each([`A`, `B`] as const)(
    `orders reentrant subset results by query-function start when %s releases first`,
    async (firstRelease) => {
      const id = `reentrant-subset-start-order`
      const queryClient = createQueryClient()
      const a = { where: eq(new IR.PropRef([`category`]), `shared`) }
      const b = { where: eq(new IR.PropRef([`id`]), shared.id) }
      const aHash = hashKey([id, getLoadSubsetDemandKey(a)])
      const aResult = createDeferred<Array<Item>>()
      const bResult = createDeferred<Array<Item>>()
      const starts: Array<`A` | `B`> = []
      const queryFn = vi.fn((context: QueryFunctionContext) => {
        const where = context.meta?.loadSubsetOptions?.where
        if (
          where?.type !== `func` ||
          where.name !== `eq` ||
          where.args.length !== 2 ||
          where.args[0]?.type !== `ref` ||
          where.args[1]?.type !== `val`
        ) {
          throw new Error(`Expected a single-field equality demand`)
        }
        const source =
          where.args[0].path.length === 1 &&
          where.args[0].path[0] === `category` &&
          where.args[1].value === `shared`
            ? `A`
            : where.args[0].path.length === 1 &&
                where.args[0].path[0] === `id` &&
                where.args[1].value === shared.id
              ? `B`
              : undefined
        if (!source) throw new Error(`Unexpected subset predicate`)
        starts.push(source)
        return source === `A` ? aResult.promise : bResult.promise
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
          retry: false,
        }),
      )
      let bLoad: true | Promise<void> | undefined
      const releaseCache = queryClient.getQueryCache().subscribe((event) => {
        if (
          bLoad === undefined &&
          event.type === `updated` &&
          event.action.type === `fetch` &&
          event.query.queryHash === aHash
        ) {
          bLoad = collection._sync.loadSubset(b)
          void Promise.resolve(bLoad).catch(() => undefined)
        }
      })
      cleanups.push(async () => {
        releaseCache()
        aResult.resolve([])
        bResult.resolve([])
        await collection.cleanup()
        queryClient.clear()
      })

      const aLoad = collection._sync.loadSubset(a)
      void Promise.resolve(aLoad).catch(() => undefined)
      expect(bLoad).toBeDefined()
      expect(starts).toEqual([`B`, `A`])
      aResult.resolve([{ ...shared, name: `A` }])
      await aLoad
      expect(collection.get(shared.id)?.name).toBe(`A`)
      bResult.resolve([{ ...shared, name: `B` }])
      await bLoad
      expect(collection.get(shared.id)?.name).toBe(`A`)
      collection._sync.unloadSubset(firstRelease === `A` ? a : b)
      expect(collection.get(shared.id)?.name).toBe(`A`)
      collection._sync.unloadSubset(firstRelease === `A` ? b : a)
      expect(collection.has(shared.id)).toBe(false)
    },
  )

  /**
   * A fresh Collection instance is a separate receiving boundary for the
   * same authority law. The persisted direct row was accepted before B's
   * physical fetch, and B keeps that exact Query alive while A restarts.
   * The reference order makes the server row authoritative at A's next load.
   * A restart may issue another request if it cannot recover that order from
   * storage; it may not silently keep the older direct value at settlement.
   */
  it.each([false, true] as const)(
    `adopts a newer shared server result after persisted Collection restart with cache edit=%s`,
    async (cacheEdit) => {
      type Row = { id: string; name: string }
      const id = `shared-newer-after-persisted-restart-${cacheEdit}`
      const queryKey = [id]
      const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
      const persistence = createNodeSQLitePersistence({
        database: driver.getDatabase(),
      })
      const managed = persistence.resolvePersistenceForCollection!({
        collectionId: id,
        mode: `sync-present`,
      })
      const queryClient = createQueryClient()
      const server = { id: `x`, name: `Server` }
      let aRequests = 0
      const aQueryFn = vi.fn(() =>
        Promise.resolve(++aRequests === 1 ? [] : [server]),
      )
      const bQueryFn = vi.fn(() => Promise.resolve([server]))
      const makeA = () =>
        createCollection(
          persistedCollectionOptions<
            Row,
            string | number,
            never,
            QueryCollectionUtils<Row, string | number, Row, unknown>
          >({
            ...queryCollectionOptions<Row>({
              id,
              queryClient,
              queryKey,
              queryFn: aQueryFn,
              getKey: (row) => row.id,
              syncMode: `on-demand`,
              staleTime: Infinity,
              startSync: true,
            }),
            persistence: managed,
          }),
        )
      const firstA = makeA()
      const b = createCollection(
        queryCollectionOptions<Row>({
          id: `${id}-b`,
          queryClient,
          queryKey,
          queryFn: bQueryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
      const restart: { collection?: ReturnType<typeof makeA> } = {}
      cleanups.push(async () => {
        await restart.collection?.cleanup()
        await firstA.cleanup()
        await b.cleanup()
        queryClient.clear()
        driver.close()
      })
      const firstARequest = {}
      await firstA._sync.loadSubset(firstARequest)
      firstA._sync.unloadSubset(firstARequest)
      const callsBeforeWrite =
        aQueryFn.mock.calls.length + bQueryFn.mock.calls.length
      await firstA.utils.writeInsert({ id: `x`, name: `Direct` })
      expect(firstA.get(`x`)?.name).toBe(`Direct`)
      expect(aQueryFn.mock.calls.length + bQueryFn.mock.calls.length).toBe(
        callsBeforeWrite,
      )
      await b._sync.loadSubset({})
      await b.utils.refetch({ throwOnError: true })
      expect(b.get(`x`)?.name).toBe(`Server`)
      if (cacheEdit)
        queryClient.setQueryData(queryKey, [
          { id: `x`, name: `Local cache edit` },
        ])
      await firstA.cleanup()

      restart.collection = makeA()
      const callsBeforeRestartLoad =
        aQueryFn.mock.calls.length + bQueryFn.mock.calls.length
      await restart.collection._sync.loadSubset({})
      expect(aQueryFn.mock.calls.length + bQueryFn.mock.calls.length).toBe(
        callsBeforeRestartLoad + 1,
      )
      expect(restart.collection.get(`x`)?.name).toBe(`Server`)
    },
  )

  /**
   * A fresh persisted Collection can meet a Query cache entry fetched before
   * its accepted direct write. The shared physical Query stays unchanged
   * while B owns it: letting A patch that cache would publish A's local row
   * into B. A's SQLite row nevertheless survives cleanup. Its owner may be
   * absent (direct insert before A acquired the subset) or retained (direct
   * update after A acquired it); neither makes the old cache a new fetch.
   *
   * The independent reference orders B's server result, A's accepted write,
   * A's cleanup, and A's next acquisition. The retained cache cannot order
   * its row against the durable write, so acquisition must request a new
   * result; that result may replace the durable value. The driver uses a real QueryClient
   * shared by both Collections and a managed SQLite cache. It checks A and B,
   * the unchanged Query cache, durable storage after cleanup, request count,
   * and A's public row when the new acquisition settles. The two histories
   * distinguish the ownerless-row ambiguity guard from an owned direct
   * update whose cached Query is equally old.
   */
  it.each([`ownerless-insert`, `owned-update`] as const)(
    `keeps a persisted %s direct row ahead of an older shared Query after restart`,
    async (rowLifetime) => {
      type Row = { id: string; name: string }
      const id = `persisted-old-shared-cache-${rowLifetime}`
      const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
      const persistence = createNodeSQLitePersistence({
        database: driver.getDatabase(),
      })
      const managed = persistence.resolvePersistenceForCollection!({
        collectionId: id,
        mode: `sync-present`,
      })
      const queryClient = createQueryClient()
      const queryKey = [id]
      const server = { id: `x`, name: `Server` }
      const direct = { id: `x`, name: `Direct` }
      const newer = { id: `x`, name: `Newer` }
      const queryFn = vi
        .fn(() => Promise.resolve([newer]))
        .mockResolvedValueOnce([server])
      const makeA = () =>
        createCollection(
          persistedCollectionOptions<
            Row,
            string | number,
            never,
            QueryCollectionUtils<Row, string | number, Row, unknown>
          >({
            ...queryCollectionOptions<Row>({
              id,
              queryClient,
              queryKey,
              queryFn,
              getKey: (row) => row.id,
              syncMode: `on-demand`,
              staleTime: Infinity,
              startSync: true,
            }),
            persistence: managed,
          }),
        )
      const a = makeA()
      const b = createCollection(
        queryCollectionOptions<Row>({
          id: `${id}-b`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
      let restarted: ReturnType<typeof makeA> | undefined
      try {
        await b._sync.loadSubset({})
        if (rowLifetime === `owned-update`) await a._sync.loadSubset({})
        else await vi.waitFor(() => expect(a.status).toBe(`ready`))
        expect(a.get(`x`)?.name).toBe(
          rowLifetime === `owned-update` ? server.name : undefined,
        )
        if (rowLifetime === `owned-update`) await a.utils.writeUpdate(direct)
        else await a.utils.writeInsert(direct)
        expect(a.get(`x`)?.name).toBe(direct.name)
        expect(b.get(`x`)?.name).toBe(server.name)
        expect(queryClient.getQueryData(queryKey)).toEqual([server])
        expect(queryFn).toHaveBeenCalledOnce()

        await a.cleanup()
        const claim = await managed.adapter.claimCacheGeneration!(id)
        try {
          const durable = await managed.adapter.loadResumeSnapshot({
            kind: `managed`,
            storageCollectionId: claim.storageCollectionId,
            claimId: claim.claimId,
          })
          expect(durable.rows.find((row) => row.key === `x`)?.value).toEqual(
            direct,
          )
        } finally {
          await managed.adapter.releaseCacheGenerationClaim!(claim.claimId)
        }

        restarted = makeA()
        const callsBeforeAcquisition = queryFn.mock.calls.length
        await restarted._sync.loadSubset({})
        const newRequests = queryFn.mock.calls.length - callsBeforeAcquisition
        expect(newRequests).toBe(1)
        expect(restarted.get(`x`)?.name).toBe(newer.name)
      } finally {
        await restarted?.cleanup()
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
        driver.close()
      }
    },
  )

  /**
   * A direct write is an accepted Collection row, not completion of an
   * unfinished Query request. With a held first fetch, the independent Query
   * state still has no fetched data after the write. The public Collection
   * has the accepted row; Query Core must not treat that row as a successful
   * response to ensureQueryData before the provider answers.
   */
  it(`does not turn a pending eager Query into cached fetched data`, async () => {
    const id = `pending-query-direct-write`
    const first = createDeferred<Array<Item>>()
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [first.promise],
    })
    cleanups.push(() => {
      first.resolve([])
      return Promise.resolve()
    })
    const preload = collection.preload()
    void preload.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    expect(query.state.status).toBe(`pending`)
    await collection.utils.writeInsert(shared)
    expect(collection.has(shared.id)).toBe(true)
    expect(query.state.data).toBeUndefined()
    expect(query.state.status).toBe(`pending`)
    first.resolve([])
    await preload
  })

  /**
   * Disabling the eager Query leaves a valid pending, idle cache entry. The
   * existing eager cache-seeding contract applies without an in-flight
   * request: the accepted row enters the raw-row cache. Query must then be
   * coherent for consumers, while its untouched timestamp still says that
   * no provider fetch has established freshness. This distinguishes the
   * legal idle seed from an unfinished request, which cannot be completed by
   * a direct write. Collection readiness still waits for a provider result.
   */
  it(`seeds an idle pending eager Query coherently without marking it fresh`, async () => {
    type Row = { id: string; name: string }
    const id = `pending-idle-direct-write`
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([] as Array<Row>))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `eager`,
        enabled: false,
        staleTime: 1_000,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    expect(query.state.status).toBe(`pending`)
    expect(query.state.fetchStatus).toBe(`idle`)
    await collection.utils.writeInsert({ id: `x`, name: `Manual` })
    expect(collection.get(`x`)?.name).toBe(`Manual`)
    expect(query.state.status).toBe(`success`)
    expect(query.state.data).toEqual([{ id: `x`, name: `Manual` }])
    expect(query.state.dataUpdatedAt).toBe(0)
    expect(query.isStaleByTime(1_000)).toBe(true)
    expect(queryFn).not.toHaveBeenCalled()
    expect(collection.status).toBe(`loading`)
  })

  /**
   * A direct write may leave a derived response envelope stale, but a later
   * subset load cannot resolve successfully with no rows when both its cache
   * and provider contain one. The history loads one row, writes it, retires
   * its only subset lease, then reacquires the same Query. The independent
   * response model has one row at load settlement; the Collection must too.
   */
  it(`restores a derived selected subset from its cached result after reacquisition`, async () => {
    const id = `derived-select-reacquisition`
    const before = { id: `x`, name: `Before` }
    const response = { edges: [{ node: before }] }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) =>
          value.edges.map((edge) => edge.node),
        getKey: (row: typeof before) => row.id,
        syncMode: `on-demand`,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    const firstRequest = {}
    await collection._sync.loadSubset(firstRequest)
    await collection.utils.writeUpdate({ id: before.id, name: `After` })
    collection._sync.unloadSubset(firstRequest)
    expect(collection.has(before.id)).toBe(false)
    await collection._sync.loadSubset({})
    expect(collection.has(before.id)).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * Restarted eager sync has the same readiness obligation as a reacquired
   * subset. A derived cache envelope may remain untouched by a direct write,
   * but a new sync session must establish its source rows before reporting
   * ready. The provider returns one row and no post-write refetch is caused by
   * the write itself; restart may fetch to regain result authority.
   */
  it(`restores a derived selected eager result after sync restart`, async () => {
    const id = `derived-select-eager-restart`
    const row = { id: `x`, name: `Server` }
    const response = { edges: [{ node: row }] }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) =>
          value.edges.map((edge) => edge.node),
        getKey: (value: typeof row) => value.id,
        syncMode: `eager`,
        staleTime: Infinity,
        gcTime: Infinity,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    await collection.preload()
    await collection.utils.writeUpdate({ id: row.id, name: `Manual` })
    expect(queryFn).toHaveBeenCalledTimes(1)
    await collection.cleanup()
    const subscription = collection.subscribeChanges(() => {})
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    await collection.stateWhenReady()
    expect(collection.has(row.id)).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A fetched source snapshot still owns every row it returned when a direct
   * write lands during its request. The reference overlays the accepted write
   * on that snapshot. A derived `select` has no inverse into the cached
   * envelope, so this checks public rows and initial readiness after the held
   * fetch settles without requiring a rewritten Query cache response.
   */
  it.each([`eager`, `on-demand`] as const)(
    `applies a derived selected %s fetch that began before a direct write`,
    async (syncMode) => {
      type Row = { id: string; name: string }
      const id = `derived-select-older-fetch-${syncMode}`
      const fetched = { edges: [{ node: { id: `server`, name: `Fetched` } }] }
      const gate = createDeferred<typeof fetched>()
      const queryClient = createQueryClient()
      const queryFn = vi.fn(() => gate.promise)
      const collection = createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          select: (response: typeof fetched) =>
            response.edges.map((edge) => edge.node),
          getKey: (row: Row) => row.id,
          syncMode,
          startSync: true,
        }),
      )
      cleanups.push(async () => {
        gate.resolve(fetched)
        await collection.cleanup()
        queryClient.clear()
      })

      const ready =
        syncMode === `eager`
          ? collection.preload()
          : Promise.resolve(collection._sync.loadSubset({}))
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      await collection.utils.writeInsert({ id: `manual`, name: `Written` })
      gate.resolve(fetched)
      await vi.waitFor(() =>
        expect(collection.get(`server`)?.name).toBe(`Fetched`),
      )
      await ready
      expect(
        Object.fromEntries(
          Array.from(collection.values(), (row) => [row.id, row.name]),
        ),
      ).toEqual({ server: `Fetched`, manual: `Written` })
      expect(queryFn).toHaveBeenCalledTimes(1)
    },
  )

  /**
   * A deferred refresh barrier prevents a fetched row from becoming public
   * while an optimistic mutation persists. A direct write to another key
   * cannot bypass that boundary merely because a derived select has no cache
   * inverse. The authored response adds a new server row; the independent
   * public snapshot contains only the direct-written row until release.
   */
  it(`holds a derived selected older result behind the refresh barrier`, async () => {
    const id = `derived-select-held-refresh`
    const initial = { id: `x`, name: `Before` }
    const server = { id: `y`, name: `Server` }
    const response = (rows: Array<typeof initial>) => ({
      edges: rows.map((node) => ({ node })),
    })
    const held = createDeferred<ReturnType<typeof response>>()
    const barrier = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce(response([initial]))
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValue(response([server]))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: ReturnType<typeof response>) =>
          value.edges.map((edge) => edge.node),
        getKey: (row: typeof initial) => row.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      held.resolve(response([server]))
      collection.deferDataRefresh = null
      barrier.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.preload()
    collection.deferDataRefresh = barrier.promise
    const refetch = collection.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await collection.utils.writeUpdate({ id: initial.id, name: `Manual` })
    held.resolve(response([{ ...initial, name: `Older` }, server]))
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    await vi.waitFor(() => expect(query.state.fetchStatus).toBe(`idle`))
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(collection.get(initial.id)?.name).toBe(`Manual`)
    expect(collection.has(server.id)).toBe(false)
    collection.deferDataRefresh = null
    barrier.resolve()
    await refetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(collection.has(server.id)).toBe(true))
  })

  /**
   * A silent cancellation that replaces a Query fetch lets public Collection
   * refetch callers follow the successor, as Query Core does for its own
   * `cancelRefetch` path. The reference is the successor's applied row at
   * both public refetch settlements. A raw QueryClient `fetchQuery` waiter
   * holds the retryer promise instead and may receive `CancelledError`; that
   * is Query Core's separate boundary. Holding the first fetch distinguishes
   * a synchronous replacement from a cancellation awaited before replacement.
   */
  it(`settles overlapping explicit refetch callers on the replacement`, async () => {
    type Row = { id: string; name: string }
    const id = `overlapping-post-write-refetch`
    const first = createDeferred<Array<Row>>()
    const replacement = createDeferred<Array<Row>>()
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `x`, name: `Initial` }])
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(() => replacement.promise)
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      first.resolve([{ id: `x`, name: `Old` }])
      replacement.resolve([{ id: `x`, name: `Server` }])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.preload()
    let earlierOutcome = `pending`
    const earlier = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        earlierOutcome = `resolved`
        return { outcome: earlierOutcome, row: collection.get(`x`)?.name }
      },
      (error) => {
        earlierOutcome = isCancelledError(error) ? `cancelled` : `rejected`
        return { outcome: earlierOutcome, row: collection.get(`x`)?.name }
      },
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    let externalOutcome = `pending`
    const external = queryClient
      .fetchQuery({ queryKey: [id], queryFn, staleTime: 0 })
      .then(
        (rows) => {
          externalOutcome = `resolved`
          return { outcome: externalOutcome, row: rows[0]?.name }
        },
        (error) => {
          externalOutcome = isCancelledError(error) ? `cancelled` : `rejected`
          return { outcome: externalOutcome, row: undefined }
        },
      )
    await collection.utils.writeUpdate({ id: `x`, name: `Written` })
    const later = collection.utils.refetch({ throwOnError: true })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    expect(earlierOutcome).toBe(`pending`)
    expect(externalOutcome).toBe(`pending`)
    replacement.resolve([{ id: `x`, name: `Server` }])
    await later
    expect(await earlier).toEqual({ outcome: `resolved`, row: `Server` })
    expect(await external).toEqual({ outcome: `cancelled`, row: undefined })
    expect(collection.get(`x`)?.name).toBe(`Server`)
  })

  /**
   * A derived selected response has no safe inverse for a direct cache edit.
   * Its old cached envelope may remain, but remounting a live query without
   * a new provider result must not replay that envelope over an accepted
   * direct write. The independent reference keeps the accepted row until a
   * later fetch; this history observes both the public row and request count
   * after the live-query subscriber returns.
   */
  it(`does not replay an unpatchable eager cache response on resubscribe`, async () => {
    type Row = { id: string; name: string }
    const id = `derived-eager-resubscribe`
    const response = { data: [{ id: `x`, name: `before` }] }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) => value.data.filter(Boolean),
        getKey: (row: Row) => row.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    const createLive = () =>
      createLiveQueryCollection({
        query: (query) => query.from({ row: collection }),
      })
    const first = createLive()
    const liveQueries = [first]
    cleanups.push(async () => {
      await Promise.all(liveQueries.map((query) => query.cleanup()))
      await collection.cleanup()
      queryClient.clear()
    })

    await first.preload()
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    expect(queryClient.getQueryData<typeof response>([id])).toEqual(response)
    await first.cleanup()
    const second = createLive()
    liveQueries.push(second)
    await second.preload()
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * An outside Query observer may retain an inactive A cache with an older
   * row. The Collection row is independently held by active subset B. A
   * direct update changes that public row; remounting A and then releasing B
   * must not restore the old value. The retained cache is allowed to stay
   * stale, so this checks the ownership boundary rather than requiring a
   * cache patch the Collection cannot safely infer.
   */
  it(`keeps a direct row when a foreign-retained subset remounts`, async () => {
    type Row = { id: string; name: string; category: string }
    const id = `foreign-retained-subset-remount`
    const queryClient = createQueryClient()
    const initial = { id: `x`, name: `before`, category: `A` }
    const queryFn = vi.fn(() => Promise.resolve([{ ...initial }]))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const a = { where: eq(new IR.PropRef([`category`]), `A`) }
    const b = { where: eq(new IR.PropRef([`id`]), `x`) }
    let unsubscribe = () => {}
    cleanups.push(async () => {
      unsubscribe()
      await collection.cleanup()
      queryClient.clear()
    })
    await collection._sync.loadSubset(a)
    const aQuery = queryClient.getQueryCache().findAll({ queryKey: [id] })[0]!
    await collection._sync.loadSubset(b)
    const foreign = new QueryObserver(queryClient, {
      queryKey: aQuery.queryKey,
      queryFn,
      staleTime: Infinity,
      retry: false,
    })
    unsubscribe = foreign.subscribe(() => {})
    collection._sync.unloadSubset(a)
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    expect(
      queryClient.getQueryData<Array<Row>>(aQuery.queryKey)?.[0]?.name,
    ).toBe(`before`)
    await collection._sync.loadSubset(a)
    collection._sync.unloadSubset(b)
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A listener on Query DB's observer is not an acquisition lease. After the
   * final subset unload, its public row must leave even if that listener is
   * still installed. This checks the ownership boundary, not Query Core's
   * separate cache lifetime.
   */
  it(`retires a zero-lease subset despite an observer listener`, async () => {
    type Row = { id: string; name: string }
    const id = `listener-retained-direct-write`
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([{ id: `x`, name: `before` }]))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        staleTime: Number.POSITIVE_INFINITY,
      }),
    )
    let releaseListener = () => {}
    cleanups.push(async () => {
      releaseListener()
      await collection.cleanup()
      queryClient.clear()
    })

    const request = {}
    await collection._sync.loadSubset(request)
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    const observer = query.observers[0]!
    releaseListener = observer.subscribe(() => {})
    expect(collection.get(`x`)?.name).toBe(`before`)
    collection._sync.unloadSubset(request)
    expect(observer.hasListeners()).toBe(true)
    expect(collection.has(`x`)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * A fetched result may have reached the Query cache while its persisted
   * baseline scan still holds Collection application. Its new row has no
   * committed owner yet. A direct write to that row must patch the provisional
   * cache entry before any later cache replay; the independent reference
   * overlays the accepted write on the fetched row at this held checkpoint.
   */
  it(`patches a provisional cached row while its result application waits`, async () => {
    const id = `pending-result-cache-patch`
    const queryHash = hashKey([id])
    const before = { ...shared, name: `Before` }
    const provisional = { id: `new`, category: `shared`, name: `Older` }
    const manual = { ...provisional, name: `Manual` }
    const scan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => scan.promise)
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      results: [[before], [provisional]],
      scanPersistedRows,
    })
    cleanups.push(() => {
      scan.resolve([])
      return Promise.resolve()
    })
    const request = {}
    await collection._sync.loadSubset(request)
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    const foreign = new QueryObserver(queryClient, {
      queryKey: [id],
      queryFn,
      staleTime: Infinity,
    })
    const release = foreign.subscribe(() => {})
    cleanups.push(() => Promise.resolve(release()))
    collection._sync.unloadSubset(request)
    await collection.utils.writeDelete(before.id)
    collection._state.syncedCollectionMetadata.set(
      `queryCollection:gc:${queryHash}`,
      {
        queryHash,
        mode: `until-revalidated`,
      },
    )
    const load = Promise.resolve(collection._sync.loadSubset({ refetch: true }))
    void load.catch(() => undefined)
    await vi.waitFor(() => expect(query.state.data).toEqual([provisional]))
    expect(scanPersistedRows).toHaveBeenCalled()
    await collection.utils.writeUpsert(manual)
    expect(query.state.data).toEqual([manual])
    scan.resolve([])
    await load
    expect(collection.get(manual.id)?.name).toBe(`Manual`)
  })

  /**
   * A fetch-start position is needed only while its subset observer remains
   * live. The reference count after retiring eight distinct subset leases is
   * zero. Instrument maps receiving this fixture's unique Query hashes,
   * distinguish fetch positions by their distinct values across eight
   * requests, then compare retained entries after every subset unloads.
   */
  it(`retires fetch-start positions with their subset observers`, async () => {
    type Row = { id: string }
    const id = `fetch-start-retirement`
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([] as Array<Row>))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const originals = Map.prototype.set
    const stamped = new Set<Map<unknown, unknown>>()
    const setSpy = vi.spyOn(Map.prototype, `set`).mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
      value: unknown,
    ) {
      if (
        typeof key === `string` &&
        key.includes(id) &&
        typeof value === `number`
      ) {
        stamped.add(this)
      }
      return originals.call(this, key, value)
    })
    const demands = Array.from({ length: 8 }, (_, index) => ({
      where: eq(new IR.PropRef([`id`]), String(index)),
    }))
    try {
      for (const demand of demands) await collection._sync.loadSubset(demand)
    } finally {
      setSpy.mockRestore()
    }
    const fetchStarts = [...stamped].find((map) => {
      const positions = demands.map((demand) =>
        map.get(hashKey([id, getLoadSubsetDemandKey(demand)])),
      )
      return (
        positions.every((position) => typeof position === `number`) &&
        new Set(positions).size === demands.length
      )
    })
    expect(fetchStarts).toBeDefined()
    expect(
      [...fetchStarts!.keys()].filter((key) => String(key).includes(id)),
    ).toHaveLength(8)
    for (const demand of demands) collection._sync.unloadSubset(demand)
    expect(
      [...fetchStarts!.keys()].filter((key) => String(key).includes(id)),
    ).toHaveLength(0)
  })

  /**
   * Persisted retention may keep an unfinished Query after its final observer
   * lease ends. Its fetch-start position must survive that interval so a later
   * lease can compare the request with a direct write. Once the detached fetch
   * settles or its Query leaves the cache, no request can reuse that position.
   * The reference holds one position at unload and zero at either terminal
   * checkpoint. The driver records the same map as the retirement witness.
   */
  it.each([`settlement`, `cache removal`] as const)(
    `retires a persisted Query's fetch-start position after detached %s`,
    async (ending) => {
      const id = `retained-fetch-start-retirement`
      const queryHash = hashKey([id])
      const pending = createDeferred<Array<Item>>()
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        results: [pending.promise],
        persistedGcTime: Number.POSITIVE_INFINITY,
        scanPersistedRows: () => Promise.resolve([]),
      })
      const originalSet = Map.prototype.set
      const stamped = new Set<Map<unknown, unknown>>()
      const setSpy = vi
        .spyOn(Map.prototype, `set`)
        .mockImplementation(function (
          this: Map<unknown, unknown>,
          key: unknown,
          value: unknown,
        ) {
          if (key === queryHash && typeof value === `number`) stamped.add(this)
          return originalSet.call(this, key, value)
        })
      const request = {}
      const load = Promise.resolve(collection._sync.loadSubset(request))
      void load.catch(() => undefined)
      try {
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      } finally {
        setSpy.mockRestore()
      }
      const query = queryClient.getQueryCache().find({ queryKey: [id] })!
      collection._sync.unloadSubset(request)
      expect(query.state.fetchStatus).toBe(`fetching`)
      const fetchStarts = [...stamped].find(
        (map) =>
          typeof map.get(queryHash) === `number` &&
          Number.isFinite(map.get(queryHash)) &&
          map.get(queryHash) !== 0,
      )
      expect(fetchStarts).toBeDefined()
      expect(fetchStarts!.has(queryHash)).toBe(true)
      if (ending === `settlement`) {
        pending.resolve([])
        await vi.waitFor(() => expect(query.state.fetchStatus).toBe(`idle`))
      } else {
        queryClient.removeQueries({ queryKey: [id], exact: true })
      }
      expect(fetchStarts!.has(queryHash)).toBe(false)
      pending.resolve([])
      await load.catch(() => undefined)
    },
  )

  /**
   * An explicit refetch after a direct write asks the provider for a result
   * newer than that write. The reference is request order: a request begun
   * before the write cannot discharge the later refetch, even when Query Core
   * has no cached data and would normally reuse the pending request. The
   * legal history holds the initial request, writes a row, deletes it, then
   * refetches. At settlement, the public row set must equal the second
   * provider response and the provider must have received two requests.
   */
  it(`starts a post-write request for explicit refetch during an empty-cache fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `post-write-explicit-refetch`
    const first = createDeferred<Array<Row>>()
    const started = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => {
      if (queryFn.mock.calls.length === 1) {
        started.resolve()
        return first.promise
      }
      return Promise.resolve([] as Array<Row>)
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      first.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.utils.writeInsert({ id: `x`, name: `local` })
    const load = Promise.resolve(collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    await started.promise
    await collection.utils.writeDelete(`x`)
    const refetch = collection.utils.refetch({ throwOnError: true })
    first.resolve([{ id: `x`, name: `stale` }])
    await refetch
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.has(`x`)).toBe(false)
    await load.catch(() => undefined)
  })

  /**
   * An explicit subset refetch has the same post-write request-order promise
   * as utils.refetch. The first empty-cache request begins before a direct
   * delete; a second load with `refetch: true` must start a newer request.
   * At that load's settlement, the public row reflects the newer response.
   */
  it(`starts a post-write request for an explicit subset refetch`, async () => {
    const id = `subset-post-write-refetch`
    const first = createDeferred<Array<Item>>()
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [first.promise, []],
    })
    await collection.utils.writeInsert(shared)
    const initialLoad = Promise.resolve(collection._sync.loadSubset({}))
    void initialLoad.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    await collection.utils.writeDelete(shared.id)
    const refetchLoad = Promise.resolve(
      collection._sync.loadSubset({ refetch: true }),
    )
    first.resolve([{ ...shared, name: `Stale` }])
    await refetchLoad
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.has(shared.id)).toBe(false)
    await initialLoad.catch(() => undefined)
  })

  /**
   * A deferred refresh is scheduled when a successful cached result is
   * refetching while the barrier is held. After a direct delete, releasing the
   * barrier starts a newer request. The independent request-order rule needs
   * that third provider call before the older refetch is allowed to settle.
   */
  it(`starts a post-write request when a deferred refresh barrier releases`, async () => {
    const id = `deferred-post-write-refetch`
    const older = createDeferred<Array<Item>>()
    const barrier = createDeferred<void>()
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[shared], older.promise, []],
    })
    const release = barrier.promise.then(() => {
      collection.deferDataRefresh = null
    })
    cleanups.push(() => {
      older.resolve([])
      barrier.resolve()
      return Promise.resolve()
    })
    await collection._sync.loadSubset({})
    collection.deferDataRefresh = barrier.promise
    const refetch = collection.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await collection.utils.writeDelete(shared.id)
    barrier.resolve()
    await release
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    older.resolve([{ ...shared, name: `Stale` }])
    await refetch.catch(() => undefined)
    expect(collection.has(shared.id)).toBe(false)
  })

  /**
   * Retiring a subset can retain its persisted rows while Query Core keeps an
   * unfinished, empty-cache request. Reacquiring that subset does not make the
   * old request newer. The reference is request order: after an accepted direct
   * delete, an explicit refetch must start a post-write request, and its public
   * settlement must observe that request's rows. Without a later write, the
   * explicit refetch may join the old request; the reacquired retained owner
   * still waits for a new revalidation request. Hold the old request across
   * unload and reacquisition in both histories to distinguish this from an
   * ordinary active fetch. This controlled Query Core driver does not model a
   * native SQLite adapter.
   */
  it.each([
    {
      name: `starts a post-write refetch after reacquiring a retained in-flight Query`,
      writeAfterStart: true,
    },
    {
      name: `revalidates a retained in-flight Query without a later write`,
      writeAfterStart: false,
    },
  ])(`$name`, async ({ writeAfterStart }) => {
    const id = `retained-post-write-refetch`
    const stale = { ...shared, name: `Stale` }
    const fresh = { ...shared, name: `Fresh` }
    const first = createDeferred<Array<Item>>()
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      results: [first.promise, writeAfterStart ? [] : [fresh]],
      persistedGcTime: Number.POSITIVE_INFINITY,
      scanPersistedRows: () => Promise.resolve([]),
    })

    await collection.utils.writeInsert(shared)
    const initialRequest = {}
    const initialLoad = Promise.resolve(
      collection._sync.loadSubset(initialRequest),
    )
    void initialLoad.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    collection._sync.unloadSubset(initialRequest)
    expect(query.state.fetchStatus).toBe(`fetching`)
    expect(query.getObserversCount()).toBe(0)

    const reacquiredLoad = Promise.resolve(collection._sync.loadSubset({}))
    void reacquiredLoad.catch(() => undefined)
    expect(queryClient.getQueryCache().find({ queryKey: [id] })).toBe(query)
    expect(queryFn).toHaveBeenCalledTimes(1)
    if (writeAfterStart) await collection.utils.writeDelete(shared.id)
    const refetch = collection.utils.refetch({ throwOnError: true })
    first.resolve([stale])
    await refetch
    expect(queryFn).toHaveBeenCalledTimes(2)
    await Promise.allSettled([initialLoad, reacquiredLoad])
    if (writeAfterStart) {
      expect(collection.has(shared.id)).toBe(false)
    } else {
      expect(collection.get(shared.id)?.name).toBe(fresh.name)
    }
  })

  /**
   * A Query can keep fetching after ordinary subset cleanup when an outside
   * observer still owns it. That request began before a later direct delete.
   * Reacquisition cannot promote it above the delete. The request-order model
   * keeps the deletion when the old result settles; an explicit refetch must
   * instead start a new request. Both histories observe the public row at
   * their load or refetch settlement checkpoint.
   */
  it.each([`old result`, `explicit refetch`] as const)(
    `preserves a direct delete across ordinary unload and reacquisition: %s`,
    async (ending) => {
      const id = `ordinary-unload-post-write-${ending}`
      const stale = { ...shared, name: `Stale` }
      const first = createDeferred<Array<Item>>()
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        results: [first.promise, []],
      })
      await collection.utils.writeInsert(shared)
      const initialRequest = {}
      const initialLoad = Promise.resolve(
        collection._sync.loadSubset(initialRequest),
      )
      void initialLoad.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      const query = queryClient.getQueryCache().find({ queryKey: [id] })!
      const foreign = new QueryObserver(queryClient, {
        queryKey: [id],
        queryFn,
        staleTime: Number.POSITIVE_INFINITY,
      })
      const unsubscribe = foreign.subscribe(() => {})
      cleanups.push(() => {
        unsubscribe()
        return Promise.resolve()
      })
      collection._sync.unloadSubset(initialRequest)
      expect(query.state.fetchStatus).toBe(`fetching`)
      expect(query.getObserversCount()).toBe(1)
      await collection.utils.writeDelete(shared.id)
      const reacquiredLoad = Promise.resolve(collection._sync.loadSubset({}))
      void reacquiredLoad.catch(() => undefined)
      expect(queryClient.getQueryCache().find({ queryKey: [id] })).toBe(query)

      if (ending === `explicit refetch`) {
        const refetch = collection.utils.refetch({ throwOnError: true })
        first.resolve([stale])
        await refetch
        expect(queryFn).toHaveBeenCalledTimes(2)
      } else {
        first.resolve([stale])
      }
      await reacquiredLoad
      expect(collection.has(shared.id)).toBe(false)
      await initialLoad.catch(() => undefined)
    },
  )

  /**
   * A fetched result and accepted direct writes form a per-key ordered merge.
   * The independent reference overlays writes accepted after fetch start onto
   * fetched rows, but does not add unrelated keys to an on-demand scope. This
   * history covers a previously owned row, a held explicit refetch, a later
   * direct update, and an unrelated direct insert. The Collection rows and Query cache are compared when
   * the refetch settles; the eager sibling above covers the other sync mode.
   */
  it(`keeps a later on-demand direct update over an older refetch row`, async () => {
    type Row = { id: string; name: string }
    const id = `on-demand-older-fetch-write`
    const held = createDeferred<Array<Row>>()
    const started = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => {
      if (queryFn.mock.calls.length === 1)
        return Promise.resolve([{ id: `x`, name: `before` }])
      started.resolve()
      return held.promise
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      held.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    const refetch = collection.utils.refetch({ throwOnError: true })
    await started.promise
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    await collection.utils.writeInsert({ id: `y`, name: `outside scope` })
    held.resolve([{ id: `x`, name: `before` }])
    await refetch
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(collection.get(`y`)?.name).toBe(`outside scope`)
    expect(queryClient.getQueryData<Array<Row>>([id])).toEqual([
      { id: `x`, name: `after` },
    ])
  })

  /**
   * A cached row with a subset owner does not give a later local cache edit
   * server authority over an accepted direct update. The independent order
   * has four values: fetched Server, A's Manual write, a QueryClient-only
   * cache edit, then a new provider fetch. The edit is visible to B through
   * its Query observer, but A keeps Manual until the final fetch starts after
   * the write and returns Newer. This crosses the owned-row state omitted by
   * the ownerless shared-cache histories. The real QueryClient drives both
   * Collections; public rows and provider calls are checked after the edit
   * and after the optional fetch. The neighboring fetch history rejects a
   * repair that permanently shields A from server results.
   */
  it.each([
    { history: `local-cache-edit`, fetchAfterEdit: false },
    { history: `newer-provider-fetch`, fetchAfterEdit: true },
  ])(
    `keeps owned direct-row authority across $history`,
    async ({ fetchAfterEdit }) => {
      type Row = { id: string; name: string }
      const id = `owned-direct-cache-edit-${fetchAfterEdit}`
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
        .mockResolvedValue([{ id: `x`, name: `Newer` }])
      const makeCollection = (suffix: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `${id}-${suffix}`,
            queryClient,
            queryKey: [id],
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`)
      const b = makeCollection(`b`)
      cleanups.push(async () => {
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await a._sync.loadSubset({})
      await b._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledOnce()
      await a.utils.writeUpdate({ id: `x`, name: `Manual` })
      expect(a.get(`x`)?.name).toBe(`Manual`)
      expect(b.get(`x`)?.name).toBe(`Server`)

      queryClient.setQueryData([id], [{ id: `x`, name: `Local edit` }])
      await vi.waitFor(() => expect(b.get(`x`)?.name).toBe(`Local edit`))
      expect(queryFn).toHaveBeenCalledOnce()
      if (!fetchAfterEdit) {
        expect(a.get(`x`)?.name).toBe(`Manual`)
        return
      }

      await b.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(a.get(`x`)?.name).toBe(`Newer`)
      expect(b.get(`x`)?.name).toBe(`Newer`)
    },
  )

  /**
   * Starting a newer physical fetch does not publish its answer. While that
   * request is held, a manual Query cache edit remains local and cannot
   * replace A's accepted direct row. The independent reference orders the
   * direct write, fetch start, local edit, and fetch result separately. The
   * held cut distinguishes fetch-start authority from result authority; the
   * final cut admits the actual newer server row.
   */
  it(`keeps an owned direct row through a local cache edit during a held fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `owned-direct-held-fetch-cache-edit`
    const queryClient = createQueryClient()
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `${id}-${suffix}`,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const b = makeCollection(`b`)
    cleanups.push(async () => {
      held.resolve([{ id: `x`, name: `Newer` }])
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await a._sync.loadSubset({})
    await b._sync.loadSubset({})
    await a.utils.writeUpdate({ id: `x`, name: `Manual` })
    const refetch = b.utils.refetch({ throwOnError: true })
    await requestStarted.promise
    queryClient.setQueryData([id], [{ id: `x`, name: `Local edit` }])
    await vi.waitFor(() => expect(b.get(`x`)?.name).toBe(`Local edit`))
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(a.get(`x`)?.name).toBe(`Manual`)

    held.resolve([{ id: `x`, name: `Newer` }])
    await refetch
    expect(a.get(`x`)?.name).toBe(`Newer`)
    expect(b.get(`x`)?.name).toBe(`Newer`)
  })

  /**
   * A local cache edit still lacks server authority after A releases and
   * reacquires its sole subset. The direct update owned that subset, so its
   * row retires on unload; the retained Query cache then contains a manual
   * edit that cannot establish a new owned row. The independent reference
   * requires a physical result before load settlement. An outside Query
   * observer keeps the cache alive, and the held-request checkpoint rejects
   * treating the manual edit as a successful fetch.
   */
  it(`revalidates a sole owner's manually edited cache on reacquisition`, async () => {
    type Row = { id: string; name: string }
    const id = `owned-direct-manual-cache-reacquisition`
    const queryClient = createQueryClient()
    const queryKey = [id]
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const collection = createCollection(
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
    const outside = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      enabled: false,
      staleTime: Infinity,
    })
    const unsubscribeOutside = outside.subscribe(() => {})
    cleanups.push(async () => {
      held.resolve([newer])
      unsubscribeOutside()
      await collection.cleanup()
      queryClient.clear()
    })

    const initialRequest = {}
    await collection._sync.loadSubset(initialRequest)
    await collection.utils.writeUpdate({ id: `x`, name: `Manual` })
    queryClient.setQueryData(queryKey, [{ id: `x`, name: `Local edit` }])
    expect(collection.get(`x`)?.name).toBe(`Manual`)
    collection._sync.unloadSubset(initialRequest)
    expect(collection.has(`x`)).toBe(false)
    const load = Promise.resolve(collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(collection.has(`x`)).toBe(false)
    held.resolve([newer])
    await load
    expect(collection.get(`x`)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A direct cache edit is a notification, not a Query result. Its independent
   * reference keeps the last fetch error and Query's invalidation/freshness
   * metadata while replacing only an already cached row. The grammar here
   * covers an error, a pending invalidation, and an expired timestamp; the checkpoints are
   * Collection utilities, Query cache state, and the accepted Collection row.
   */
  it.each(
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      ([`error`, `invalidation`, `stale`] as const).map((cut) => ({
        syncMode,
        cut,
      })),
    ),
  )(
    `preserves Query $cut state across a $syncMode direct cache patch`,
    async ({ syncMode, cut }) => {
      type Row = { id: string; name: string }
      const id = `direct-cache-${cut}`
      const queryClient = createQueryClient(false, 1000)
      const fetchError = new Error(`fetch failed`)
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `before` }])
        .mockRejectedValueOnce(fetchError)
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (row) => row.id,
          syncMode,
          startSync: true,
        }),
      )
      cleanups.push(async () => {
        await collection.cleanup()
        queryClient.clear()
      })
      if (syncMode === `eager`) await collection.preload()
      else await collection._sync.loadSubset({})
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: [id], exact: true })!
      if (cut === `error`) {
        await collection.utils.refetch()
        expect(collection.utils.lastError).toBe(fetchError)
      } else {
        if (cut === `invalidation`) {
          await queryClient.invalidateQueries({
            queryKey: [id],
            exact: true,
            refetchType: `none`,
          })
          expect(query.state.isInvalidated).toBe(true)
        } else {
          query.setState({ dataUpdatedAt: Date.now() - 60_000 })
          expect(query.isStale()).toBe(true)
        }
      }
      const updatedAt = query.state.dataUpdatedAt
      await collection.utils.writeUpdate({ id: `x`, name: `after` })
      expect(collection.get(`x`)?.name).toBe(`after`)
      expect(query.state.dataUpdatedAt).toBe(updatedAt)
      if (cut === `error`) {
        expect(collection.utils.lastError).toBe(fetchError)
        expect(collection.utils.errorCount).toBe(1)
      } else if (cut === `invalidation`) {
        expect(query.state.isInvalidated).toBe(true)
      } else {
        expect(query.isStale()).toBe(true)
      }
    },
  )

  /**
   * A Query Core hash may coalesce equivalent subset predicates into one
   * physical Query while DB retains two logical subset demands. A response
   * from a fetch started before an accepted direct write cannot undo that
   * write's key, whichever logical demand observed the fetch. A response from
   * a later fetch may replace it. The reference is the order of the authored
   * fetches and write, independent of the Query cache's chosen first key.
   *
   * The legal history uses `id = x` and `id IN [x]`, which have equal row
   * meaning but distinct demand keys. The real QueryClient coalesces them by
   * a custom hash. Their predicates overlap at `x` but have distinct demand
   * keys. The public row is compared after the write, after the held
   * older result applies, and after a post-write result applies. The provider
   * call count proves each requested fetch ran.
   */
  it(`preserves a direct write across an older aliased Query fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `aliased-fetch-write-order`
    const older = createDeferred<Array<Row>>()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `equivalent-subset-query`,
        },
      },
    })
    const before = { id: `x`, name: `Before` }
    const manual = { id: `x`, name: `Manual` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([before])
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValue([newer])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      older.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })
    const a = { where: eq(new IR.PropRef([`id`]), `x`) }
    const b = {
      where: new IR.Func(`in`, [
        new IR.PropRef([`id`]),
        new IR.Value([`x`, `y`]),
      ]),
    }
    expect(getLoadSubsetDemandKey(a)).not.toBe(getLoadSubsetDemandKey(b))

    await collection._sync.loadSubset(a)
    await collection._sync.loadSubset({ ...b, refetch: true })
    expect(collection.get(`x`)?.name).toBe(before.name)
    const held = collection._sync.loadSubset({ ...b, refetch: true })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await collection.utils.writeUpdate(manual)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    older.resolve([{ id: `x`, name: `Older` }])
    await held
    expect(collection.get(`x`)?.name).toBe(manual.name)

    await collection._sync.loadSubset({ ...b, refetch: true })
    expect(queryFn).toHaveBeenCalledTimes(4)
    expect(collection.get(`x`)?.name).toBe(newer.name)
  })

  /**
   * The physical Query may start fetching before a second overlapping logical
   * demand attaches. That demand did not observe the fetch event, but its
   * result is still older than a later accepted direct write. The independent
   * reference orders the held fetch before the write and preserves `Manual`
   * for both demands at result settlement. A later fetch remains authoritative.
   * This history distinguishes joining an in-flight Query from observing a
   * fetch that starts after both logical demands are attached.
   */
  it(`preserves a direct write when an aliased demand joins an in-flight fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `aliased-join-in-flight-fetch`
    const older = createDeferred<Array<Row>>()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `aliased-join-query`,
        },
      },
    })
    const before = { id: `x`, name: `Before` }
    const manual = { id: `x`, name: `Manual` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([before])
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValue([newer])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      older.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })
    const a = { where: eq(new IR.PropRef([`id`]), `x`) }
    const b = {
      where: new IR.Func(`in`, [
        new IR.PropRef([`id`]),
        new IR.Value([`x`, `y`]),
      ]),
    }
    expect(getLoadSubsetDemandKey(a)).not.toBe(getLoadSubsetDemandKey(b))

    await collection._sync.loadSubset(a)
    expect(collection.get(`x`)?.name).toBe(before.name)
    const held = collection._sync.loadSubset({ ...a, refetch: true })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    const joining = collection._sync.loadSubset(b)
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    await vi.waitFor(() => expect(query.getObserversCount()).toBe(2))
    await collection.utils.writeUpdate(manual)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    older.resolve([{ id: `x`, name: `Older` }])
    await Promise.all([held, joining])
    expect(collection.get(`x`)?.name).toBe(manual.name)
    expect(queryFn).toHaveBeenCalledTimes(2)

    await collection._sync.loadSubset({ ...b, refetch: true })
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(collection.get(`x`)?.name).toBe(newer.name)
  })

  /**
   * Two overlapping demands share a physical Query. A direct write lands while
   * its first refetch is held. A later physical refetch starts after the write,
   * then the demand whose key Query Core uses retires. The remaining demand
   * did not run the Query function, but the new fetch is authoritative for
   * its row. The independent reference uses the authored fetch/write order:
   * `Newer` must replace `Manual` when the replacement result applies. This
   * distinguishes fetch-event propagation from attach-time initialization.
   */
  it(`applies a post-write fetch to an aliased demand after its peer retires`, async () => {
    type Row = { id: string; name: string }
    const id = `aliased-peer-retires-after-fetch-start`
    const older = createDeferred<Array<Row>>()
    const replacement = createDeferred<Array<Row>>()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `aliased-peer-retirement-query`,
        },
      },
    })
    const before = { id: `x`, name: `Before` }
    const manual = { id: `x`, name: `Manual` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([before])
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => replacement.promise)
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      older.resolve([])
      replacement.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })
    const a = { where: eq(new IR.PropRef([`id`]), `x`) }
    const b = {
      where: new IR.Func(`in`, [
        new IR.PropRef([`id`]),
        new IR.Value([`x`, `y`]),
      ]),
    }
    expect(getLoadSubsetDemandKey(a)).not.toBe(getLoadSubsetDemandKey(b))

    await collection._sync.loadSubset(b)
    await collection._sync.loadSubset(a)
    expect(collection.get(`x`)?.name).toBe(before.name)
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    expect(query.getObserversCount()).toBe(2)
    const held = queryClient.refetchQueries({
      predicate: (candidate) => candidate === query,
    })
    void held.catch(() => {})
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    expect(query.state.fetchStatus).toBe(`fetching`)
    await collection.utils.writeUpdate(manual)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    const postWrite = queryClient.refetchQueries({
      predicate: (candidate) => candidate === query,
    })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    collection._sync.unloadSubset(b)
    expect(query.getObserversCount()).toBe(1)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    replacement.resolve([newer])
    await postWrite
    await vi.waitFor(() => expect(collection.get(`x`)?.name).toBe(newer.name))
    older.resolve([{ id: `x`, name: `Older` }])
    await held.catch(() => {})
    expect(collection.get(`x`)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  /**
   * One physical Query has one cache-patch obligation per direct write. Two
   * distinct subset demands may alias the same Query under a custom Query
   * hash. The model counts physical Queries, not logical demand hashes. The
   * driver observes Query cache notifications and the public row after one write.
   */
  it(`patches a shared physical Query once per direct write`, async () => {
    type Row = { id: string; name: string; category: string }
    const id = `shared-physical-query-write`
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `shared-physical-query`,
        },
      },
    })
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `x`, name: `before`, category: `A` }]),
    )
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `A`),
    })
    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`id`]), `x`),
    })
    const queries = queryClient.getQueryCache().getAll()
    expect(queries).toHaveLength(1)
    let notifications = 0
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === `updated` && event.query === queries[0])
        notifications++
    })
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    unsubscribe()
    expect(notifications).toBe(1)
    expect(collection.get(`x`)?.name).toBe(`after`)
  })

  /**
   * A zero-lease logical scope can keep its observer through an outside
   * listener after its Collection handler is removed. A second logical scope
   * may share that physical Query under a custom hash and become the owner of
   * a newer row. The independent cache rule requires one patch through the
   * owning scope even when the disjoint observer is visited first.
   */
  it(`patches an aliased Query through its owning observer`, async () => {
    type Row = { id: string; name: string; category: string }
    const id = `aliased-owner-cache-patch`
    const a = { id: `a`, name: `A`, category: `A` }
    const b = { id: `b`, name: `Before`, category: `B` }
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `aliased-owner`,
        },
      },
    })
    const queryFn = vi.fn().mockResolvedValueOnce([a]).mockResolvedValue([b])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const demandA = { where: eq(new IR.PropRef([`category`]), `A`) }
    const demandB = { where: eq(new IR.PropRef([`category`]), `B`) }
    await collection._sync.loadSubset(demandA)
    const query = queryClient.getQueryCache().getAll()[0]!
    const observerA = query.observers[0]!
    const releaseOutsideListener = observerA.subscribe(() => {})
    cleanups.push(() => Promise.resolve(releaseOutsideListener()))
    collection._sync.unloadSubset(demandA)
    await collection._sync.loadSubset({ ...demandB, refetch: true })
    expect(collection.has(b.id)).toBe(true)
    expect(query.state.data).toEqual([b])
    await collection.utils.writeUpdate({ id: b.id, name: `After` })
    expect(query.state.data).toEqual([{ ...b, name: `After` }])
  })

  /**
   * A direct update to an owned row needs work in its owner's cached scope,
   * not in every disjoint scope. The independent category partition has ten
   * scopes of 1,000 rows and exactly one owner for the changed key. After
   * preload, a counted getKey boundary bounds one write to three owner-sized
   * passes plus fixed overhead. This counts actual adapter key extraction,
   * rather than timing or provider work.
   */
  it(`bounds direct cache patch work by the changed row's owners`, async () => {
    type Row = { id: string; category: string; name: string }
    const id = `direct-cache-owner-work`
    const queryClient = createQueryClient()
    let getKeyCalls = 0
    const source = Array.from({ length: 10 }, (_, category) =>
      Array.from({ length: 1000 }, (_, index) => ({
        id: `${category}-${index}`,
        category: String(category),
        name: `before`,
      })),
    ).flat()
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      const where = context.meta?.loadSubsetOptions?.where
      const lastArg = where?.type === `func` ? where.args.at(-1) : undefined
      const category = lastArg?.type === `val` ? lastArg.value : undefined
      return Promise.resolve(source.filter((row) => row.category === category))
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => {
          getKeyCalls++
          return row.id
        },
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    for (let category = 0; category < 10; category++)
      await collection._sync.loadSubset({
        where: eq(new IR.PropRef([`category`]), String(category)),
      })
    getKeyCalls = 0
    await collection.utils.writeUpdate({ id: `3-0`, name: `after` })
    expect(collection.get(`3-0`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(10)
    expect(getKeyCalls).toBeLessThanOrEqual(3010)
  })

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

    let currentRequest: LoadSubsetOptions = {}
    await collection._sync.loadSubset(currentRequest)
    history.push(`empty-result`)
    expect(rows(collection)).toEqual([])
    expect(scanPersistedRows).toHaveBeenCalledTimes(
      expectedEmptyBaselineScans(history),
    )

    for (let result = 0; result < 2; result++) {
      collection._sync.unloadSubset(currentRequest)
      currentRequest = { refetch: true }
      await collection._sync.loadSubset(currentRequest)
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

  /**
   * A retained subset owner cannot be settled by acquiring a different Query
   * key. The independent source model has one `detail` row in durable storage;
   * the current complete source keeps, omits, or moves it out of that subset.
   * After a full-source result applies, acquiring the retained subset must
   * reconcile its old owner and remove its revalidation marker. Compare public
   * and durable rows at that acquisition's settlement, before any explicit
   * refetch. The unchanged and moved cases guard against deleting a row still
   * owned by the full source.
   */
  it.each([{ name: `omitted` }, { name: `unchanged` }, { name: `moved` }])(
    `settles a retained $name subset after a complete full-source result`,
    async ({ name }) => {
      const id = `retained-subset-after-full-${name}`
      const oldRow: Item = {
        id: `detail-row`,
        category: `detail`,
        name: `Original`,
      }
      const subset = categorySubset(`detail`)
      const subsetHash = hashKey([id, getLoadSubsetDemandKey(subset)])
      const retentionKey = `queryCollection:gc:${subsetHash}`
      const storage = createOwnershipStorage({
        rows: new Map([[oldRow.id, oldRow]]),
        rowMetadata: new Map([
          [oldRow.id, { queryCollection: { owners: { [subsetHash]: true } } }],
        ]),
        collectionMetadata: new Map([
          [retentionKey, { queryHash: subsetHash, mode: `until-revalidated` }],
        ]),
      })
      const currentSource: Array<Item> =
        name === `omitted`
          ? []
          : name === `unchanged`
            ? [oldRow]
            : [{ ...oldRow, category: `list`, name: `Moved` }]
      const { collection } = createPersistedOwnershipFixture(
        id,
        storage,
        currentSource,
      )

      await collection.stateWhenReady()
      const fullRequest = {}
      await collection._sync.loadSubset(fullRequest)
      await collection._sync.loadSubset(subset)

      expect({
        publicRows: collection.toArray.map(
          ({ id: rowId, category, name: rowName }) => ({
            id: rowId,
            category,
            name: rowName,
          }),
        ),
        durableRows: storedItems(storage),
        retentionPending: storage
          .snapshot()
          .collectionMetadata.has(retentionKey),
      }).toEqual({
        publicRows: currentSource,
        durableRows: currentSource,
        retentionPending: false,
      })
      if (name === `moved`) {
        expect(
          persistedOwners(storage.snapshot().rowMetadata, oldRow.id),
        ).toEqual([hashKey([id])])
      }
      if (name === `unchanged`) {
        collection._sync.unloadSubset(fullRequest)
        expect(rows(collection)).toEqual([oldRow.id])
      }
    },
  )

  /**
   * A retained marker requires an applied authoritative source result before
   * its acquisition can fulfill. A custom Query persister may call queryFn yet
   * return a different value, so Query Core leaves its result provenance
   * unknown. The independent model therefore permits explicit rejection but
   * never successful settlement with the old durable owner still pending.
   * Cold and seeded Query caches drive the initial-wait and explicit-refetch
   * paths. The persister either forwards the source result or invokes the
   * source speculatively and returns unrelated cached rows. Direct adapter
   * load and public live-query preload compare the load outcome, Query cache,
   * public row, durable row, and marker after Query reports success.
   */
  it.each([
    { path: `direct`, cache: `cold`, result: `source` },
    { path: `live-query`, cache: `cold`, result: `source` },
    { path: `direct`, cache: `seeded`, result: `source` },
    { path: `live-query`, cache: `seeded`, result: `source` },
    { path: `direct`, cache: `cold`, result: `unrelated` },
    { path: `live-query`, cache: `cold`, result: `unrelated` },
    { path: `direct`, cache: `seeded`, result: `unrelated` },
    { path: `live-query`, cache: `seeded`, result: `unrelated` },
  ] as const)(
    `does not settle a retained owner from an opaque $result persister result through $path load with $cache cache`,
    async ({ path, cache, result }) => {
      const id = `retained-opaque-persister-${path}-${cache}-${result}`
      const queryHash = hashKey([id])
      const retentionKey = `queryCollection:gc:${queryHash}`
      const durableRow = { ...shared, name: `Durable` }
      const sourceRow = { ...shared, name: `Source` }
      const unrelatedRow = { ...shared, name: `Unrelated cache` }
      const storage = createOwnershipStorage({
        rows: new Map([[durableRow.id, durableRow]]),
        rowMetadata: new Map([
          [
            durableRow.id,
            { queryCollection: { owners: { [queryHash]: true } } },
          ],
        ]),
        collectionMetadata: new Map([
          [retentionKey, { queryHash, mode: `until-revalidated` }],
        ]),
      })
      const { collection, queryClient, queryFn } =
        createPersistedOwnershipFixture(
          id,
          storage,
          [sourceRow],
          `on-demand`,
          (client) => {
            client.setDefaultOptions({
              queries: {
                gcTime: Number.POSITIVE_INFINITY,
                retry: false,
                staleTime: Number.POSITIVE_INFINITY,
                persister: (runSource, context) => {
                  if (result === `source`) return runSource(context)
                  void runSource(context)
                  return Promise.resolve([unrelatedRow])
                },
              },
            })
            if (cache === `seeded`) client.setQueryData([id], [durableRow])
          },
        )

      await collection.stateWhenReady()
      const live =
        path === `live-query`
          ? createLiveQueryCollection((query) =>
              query.from({ row: collection }).select(({ row }) => ({
                id: row.id,
                name: row.name,
              })),
            )
          : undefined
      if (live) cleanups.push(() => live.cleanup())
      const load =
        path === `direct` ? collection._sync.loadSubset({}) : live!.preload()
      await expect(load).rejects.toThrow(/revalidat|provenance/i)
      expect(queryFn).toHaveBeenCalledOnce()
      expect(queryClient.getQueryData([id])).toEqual([
        result === `source` ? sourceRow : unrelatedRow,
      ])
      expect(collection.get(sourceRow.id)?.name).toBe(durableRow.name)
      if (live)
        expect(live.toArray.every((row) => row.name !== sourceRow.name)).toBe(
          true,
        )
      expect(storedItems(storage)).toEqual([durableRow])
      expect(storage.snapshot().collectionMetadata.has(retentionKey)).toBe(true)
    },
  )

  /**
   * The provenance restriction belongs to retained persisted ownership.
   * With no old owner to retire, a custom persister may still supply a Query
   * result through the ordinary on-demand path.
   */
  it(`applies a custom persister result without retained ownership`, async () => {
    const id = `unretained-persister`
    const row = { ...shared, name: `Persister row` }
    const queryClient = createQueryClient()
    queryClient.setDefaultOptions({
      queries: {
        persister: (runSource, context) => runSource(context),
      },
    })
    const queryFn = vi.fn(() => Promise.resolve([row]))
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
    expect(queryFn).toHaveBeenCalledOnce()
    expect(collection.get(row.id)?.name).toBe(row.name)
  })

  /**
   * A retained owner requires a newly applied source response. A manual
   * Query cache edit during a held physical fetch can make an observer report
   * success, but it cannot release the durable owner or its marker. The
   * reference has two terminal outcomes: a source-backed result replaces the
   * durable row, while a persister result with unknown provenance rejects.
   * Both direct load and public live-query preload cross this observer
   * checkpoint. The held-fetch assertion distinguishes either outcome from
   * an early, false ready state.
   */
  it.each([
    { path: `direct`, result: `source` },
    { path: `live-query`, result: `source` },
    { path: `direct`, result: `opaque` },
    { path: `live-query`, result: `opaque` },
  ] as const)(
    `waits for a retained owner's $result result after a manual cache edit through $path load`,
    async ({ path, result }) => {
      const id = `retained-manual-edit-${path}-${result}`
      const queryHash = hashKey([id])
      const retentionKey = `queryCollection:gc:${queryHash}`
      const durableRow = { ...shared, name: `Durable` }
      const manualRow = { ...shared, name: `Manual cache` }
      const sourceRow = { ...shared, name: `Source` }
      const storage = createOwnershipStorage({
        rows: new Map([[durableRow.id, durableRow]]),
        rowMetadata: new Map([
          [
            durableRow.id,
            { queryCollection: { owners: { [queryHash]: true } } },
          ],
        ]),
        collectionMetadata: new Map([
          [retentionKey, { queryHash, mode: `until-revalidated` }],
        ]),
      })
      const queryClient = createQueryClient()
      if (result === `opaque`)
        queryClient.setQueryDefaults([id], {
          persister: (runSource, context) => runSource(context),
        })
      const started = createDeferred<void>()
      const held = createDeferred<Array<Item>>()
      const queryFn = vi.fn(() => {
        started.resolve()
        return held.promise
      })
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
      let cleanupLive = async (): Promise<void> => {}
      cleanups.push(async () => {
        held.resolve([sourceRow])
        await cleanupLive()
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()
      const live =
        path === `live-query`
          ? createLiveQueryCollection((query) =>
              query.from({ row: collection }).select(({ row }) => ({
                id: row.id,
                name: row.name,
              })),
            )
          : undefined
      if (live) cleanupLive = () => live.cleanup()
      const load = Promise.resolve(
        path === `direct` ? collection._sync.loadSubset({}) : live!.preload(),
      )
      void load.catch(() => undefined)
      await started.promise
      queryClient.setQueryData([id], [manualRow])
      const beforeSource = await Promise.race([
        load.then(
          () => `fulfilled`,
          () => `rejected`,
        ),
        new Promise<`pending`>((resolve) =>
          setTimeout(() => resolve(`pending`), 0),
        ),
      ])
      expect(beforeSource).toBe(`pending`)
      expect(collection.get(durableRow.id)?.name).toBe(durableRow.name)
      expect(storedItems(storage)).toEqual([durableRow])
      expect(storage.snapshot().collectionMetadata.has(retentionKey)).toBe(true)

      held.resolve([sourceRow])
      if (result === `opaque`) {
        await expect(load).rejects.toThrow(/revalidat|provenance/i)
        expect(collection.get(durableRow.id)?.name).toBe(durableRow.name)
        expect(storedItems(storage)).toEqual([durableRow])
        expect(storage.snapshot().collectionMetadata.has(retentionKey)).toBe(
          true,
        )
      } else {
        await load
        expect(collection.get(sourceRow.id)?.name).toBe(sourceRow.name)
        expect(storedItems(storage)).toEqual([sourceRow])
        expect(storage.snapshot().collectionMetadata.has(retentionKey)).toBe(
          false,
        )
      }
      expect(queryFn).toHaveBeenCalledOnce()
    },
  )

  /**
   * A process can stop while a persisted subset is active, before unload
   * writes a retention marker. Its durable row owner still needs
   * revalidation. The hot run below creates that state through the real
   * persistence path; the cold run starts from its snapshot. A complete full
   * result may reconcile the old owner itself, or the next subset acquisition
   * may do so. At that acquisition's settlement, an omitted row must be gone
   * from public rows, durable rows, and durable owner metadata. This witness
   * rejects a gate that checks only for a retention marker.
   */
  it(`revalidates a markerless persisted subset owner after full-source loading`, async () => {
    const id = `markerless-subset-after-full`
    const oldRow: Item = {
      id: `detail-row`,
      category: `detail`,
      name: `Original`,
    }
    const subset = categorySubset(`detail`)
    const subsetHash = hashKey([id, getLoadSubsetDemandKey(subset)])
    const retentionKey = `queryCollection:gc:${subsetHash}`
    const hotStorage = createOwnershipStorage()
    const hot = createPersistedOwnershipFixture(id, hotStorage, [oldRow])
    await hot.collection.stateWhenReady()
    await hot.collection._sync.loadSubset(subset)
    const crashSnapshot = hotStorage.snapshot()
    expect(storedItems(hotStorage)).toEqual([oldRow])
    expect(persistedOwners(crashSnapshot.rowMetadata, oldRow.id)).toEqual([
      subsetHash,
    ])
    expect(crashSnapshot.collectionMetadata.has(retentionKey)).toBe(false)
    await hot.collection.cleanup()

    const coldStorage = createOwnershipStorage(crashSnapshot)
    const cold = createPersistedOwnershipFixture(id, coldStorage, [])
    await cold.collection.stateWhenReady()
    // On-demand restore does not publish rows before a subset asks for them.
    expect(storedItems(coldStorage)).toEqual([oldRow])
    expect(
      persistedOwners(coldStorage.snapshot().rowMetadata, oldRow.id),
    ).toEqual([subsetHash])
    expect(coldStorage.snapshot().collectionMetadata.has(retentionKey)).toBe(
      false,
    )
    await cold.collection._sync.loadSubset({})
    await cold.collection._sync.loadSubset(subset)
    expect(rows(cold.collection)).toEqual([])
    expect(storedItems(coldStorage)).toEqual([])
    expect(
      persistedOwners(coldStorage.snapshot().rowMetadata, oldRow.id),
    ).toEqual([])
  })

  /**
   * A retained row is a prior durable baseline, not authority for a provider
   * result whose last acquisition releases during getKey. The independent
   * source has replaced `old` with `fresh`. Without a peer, the attempted
   * result is unaccepted: `fresh` must not become public or durable, and the
   * old owner remains available for later revalidation. With a peer, that
   * same physical result may apply for the peer and retire `old`. A cold run
   * with an empty source then retires whichever row remained in storage.
   * The provider, pre-response pending load, public rows, durable rows, owner
   * metadata, and retention marker are compared at each settlement cut. The
   * persisted wrapper may fulfill a released direct `_sync` promise after
   * dropping its source result; this oracle does not assign that internal
   * promise a caller-specific cancellation outcome.
   */
  it.each([
    { marker: false, peer: false },
    { marker: true, peer: false },
    { marker: false, peer: true },
    { marker: true, peer: true },
  ])(
    `revalidates a retained row after release during result application, marker=$marker, peer=$peer`,
    async ({ marker, peer }) => {
      const id = `retained-release-during-application-${marker}-${peer}`
      const oldRow: Item = { id: `old`, category: `detail`, name: `Old` }
      const freshRow: Item = { id: `fresh`, category: `detail`, name: `Fresh` }
      const firstRequest = categorySubset(`detail`)
      const peerRequest = categorySubset(`detail`)
      const scopeHash = hashKey([id, getLoadSubsetDemandKey(firstRequest)])
      const retentionKey = `queryCollection:gc:${scopeHash}`
      const storage = createOwnershipStorage({
        rows: new Map([[oldRow.id, oldRow]]),
        rowMetadata: new Map([
          [oldRow.id, { queryCollection: { owners: { [scopeHash]: true } } }],
        ]),
        collectionMetadata: new Map(
          marker
            ? [
                [
                  retentionKey,
                  { queryHash: scopeHash, mode: `until-revalidated` },
                ],
              ]
            : [],
        ),
      })
      const response = createDeferred<Array<Item>>()
      const queryClient = createQueryClient()
      const queryFn = vi.fn((context: QueryFunctionContext) =>
        response.promise.then((items) =>
          selectOwnershipRows(items, context.meta?.loadSubsetOptions ?? {}),
        ),
      )
      let releaseFirst: () => void = () => {
        throw new Error(`The first acquisition is not ready for release`)
      }
      let released = false
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
            getKey: (item) => {
              if (item.id === freshRow.id && !released) {
                released = true
                releaseFirst()
              }
              return item.id
            },
            syncMode: `on-demand`,
            persistedGcTime: Number.POSITIVE_INFINITY,
            startSync: true,
          }),
          persistence: { adapter: storage.adapter },
        }),
      )
      releaseFirst = () => collection._sync.unloadSubset(firstRequest)
      cleanups.push(async () => {
        response.resolve([])
        collection._sync.unloadSubset(peerRequest)
        collection._sync.unloadSubset(firstRequest)
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
        }
      })

      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      const firstRequestResult = collection._sync.loadSubset(firstRequest)
      expect(firstRequestResult).not.toBe(true)
      const firstLoad = Promise.resolve(firstRequestResult)
      void firstLoad.catch(() => undefined)
      const peerLoad = peer
        ? Promise.resolve(collection._sync.loadSubset(peerRequest))
        : undefined
      let firstSettled = false
      void firstLoad.then(
        () => {
          firstSettled = true
        },
        () => {
          firstSettled = true
        },
      )
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(firstSettled).toBe(false)
      response.resolve([freshRow])
      await firstLoad.catch(() => undefined)
      if (peerLoad) await peerLoad
      expect(released).toBe(true)
      expect(queryFn).toHaveBeenCalledOnce()
      expect(itemIds(collection.toArray)).toEqual(
        peer ? [freshRow.id] : [oldRow.id],
      )
      const hotSnapshot = storage.snapshot()
      expect(storedItems(storage)).toEqual([peer ? freshRow : oldRow])
      expect(
        persistedOwners(
          hotSnapshot.rowMetadata,
          peer ? freshRow.id : oldRow.id,
        ),
      ).toEqual([scopeHash])
      expect(hotSnapshot.collectionMetadata.get(retentionKey)).toEqual(
        peer ? undefined : { queryHash: scopeHash, mode: `until-revalidated` },
      )

      const coldStorage = createOwnershipStorage(hotSnapshot)
      const cold = createPersistedOwnershipFixture(id, coldStorage, [])
      await cold.collection._sync.loadSubset(categorySubset(`detail`))
      expect(cold.queryFn).toHaveBeenCalledOnce()
      expect(itemIds(cold.collection.toArray)).toEqual([])
      expect(storedItems(coldStorage)).toEqual([])
      expect(coldStorage.snapshot().rowMetadata.size).toBe(0)
      expect(coldStorage.snapshot().collectionMetadata.has(retentionKey)).toBe(
        false,
      )
    },
  )

  it(`emits metadata for every owner of rows shared by overlapping queries`, async () => {
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    const { collection } = createOwnershipFixture({
      id: `persisted-overlap`,
      results: [[shared], [shared, listOnly]],
      metadataRecorder: metadata,
    })
    const detail = { where: categoryIn(`shared`, `detail`) }
    const list = { where: categoryIn(`shared`, `list`) }

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

  /**
   * A persisted owner belongs to its logical demand across an upgrade that
   * changes the demand's cache key. This serialized key is a fixture written
   * by the older singleton-IN encoder, not an expected value computed with
   * the current encoder. Revalidating that demand with an empty source result
   * must retire its old owner and retention marker at application, whether
   * the new demand is written as equality or singleton membership. Another
   * demand's claim on the same row must survive until it too revalidates.
   */
  it.each(
    [false, true].flatMap((preUpgrade) =>
      [false, true].flatMap((sharedRow) =>
        [false, true].flatMap((marker) =>
          ([`eq`, `in`] as const).map((request) => ({
            preUpgrade,
            sharedRow,
            marker,
            request,
          })),
        ),
      ),
    ),
  )(
    `retires a persisted singleton membership owner after $request revalidation, pre-upgrade $preUpgrade, shared row $sharedRow, marker $marker`,
    async ({ preUpgrade, sharedRow, marker, request }) => {
      const id = `persisted-singleton-membership-${preUpgrade}-${sharedRow}-${marker}-${request}`
      const singleton = {
        where: new IR.Func(`in`, [
          new IR.PropRef([`category`]),
          new IR.Value([`shared`]),
        ]),
      }
      const other = categorySubset(`detail`)
      const oldDemandKey = legacySingletonCategoryDemandKey
      const oldHash = hashKey([id, oldDemandKey])
      const currentDemandKey = getLoadSubsetDemandKey(singleton)
      const currentHash = hashKey([id, currentDemandKey])
      const otherHash = hashKey([id, getLoadSubsetDemandKey(other)])
      expect(currentDemandKey).not.toBe(oldDemandKey)
      expect(currentHash).not.toBe(oldHash)

      // The reference owner graph has one or two edges to the stored row.
      // Each empty source result removes exactly its demand's edge.
      const singletonHash = preUpgrade ? oldHash : currentHash
      const initialOwners = sharedRow
        ? [singletonHash, otherHash]
        : [singletonHash]
      const initialMarkers = [
        ...(marker ? [singletonHash] : []),
        ...(sharedRow ? [otherHash] : []),
      ]
      const storage = createOwnershipStorage({
        rows: new Map([[shared.id, shared]]),
        rowMetadata: new Map([
          [
            shared.id,
            {
              queryCollection: {
                owners: Object.fromEntries(
                  initialOwners.map((hash) => [hash, true]),
                ),
              },
            },
          ],
        ]),
        collectionMetadata: new Map(
          initialMarkers.map((hash) => [
            `queryCollection:gc:${hash}`,
            { queryHash: hash, mode: `until-revalidated` },
          ]),
        ),
      })
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        [],
      )
      const observe = () => {
        const snapshot = storage.snapshot()
        return {
          stored: storedItems(storage),
          public: collection.toArray.map(({ id: rowId, category, name }) => ({
            id: rowId,
            category,
            name,
          })),
          owners: persistedOwners(snapshot.rowMetadata, shared.id),
          markers: [...snapshot.collectionMetadata.keys()].sort(),
        }
      }
      const expected = (
        owners: Array<string>,
        publicVisible: boolean,
        markers = owners,
      ) => ({
        stored: owners.length ? [shared] : [],
        public: publicVisible ? [shared] : [],
        owners: [...owners].sort(),
        markers: markers.map((hash) => `queryCollection:gc:${hash}`).sort(),
      })

      await collection.stateWhenReady()
      expect(queryFn).not.toHaveBeenCalled()
      expect(observe()).toEqual(expected(initialOwners, false, initialMarkers))

      await collection._sync.loadSubset(
        request === `eq`
          ? { where: eq(new IR.PropRef([`category`]), `shared`) }
          : singleton,
      )
      expect(queryFn).toHaveBeenCalledTimes(1)
      await vi.waitFor(() =>
        expect(observe()).toEqual(
          expected(sharedRow ? [otherHash] : [], sharedRow),
        ),
      )
      if (sharedRow) {
        await collection._sync.loadSubset(other)
        await vi.waitFor(() => expect(observe()).toEqual(expected([], false)))
        expect(queryFn).toHaveBeenCalledTimes(2)
      }
    },
  )

  it(`moves a pre-upgrade singleton owner to the current key when its row remains`, async () => {
    const id = `pre-upgrade-singleton-row-remains`
    const singleton = {
      where: new IR.Func(`in`, [
        new IR.PropRef([`category`]),
        new IR.Value([`shared`]),
      ]),
    }
    const oldDemandKey = legacySingletonCategoryDemandKey
    const oldHash = hashKey([id, oldDemandKey])
    const currentHash = hashKey([id, getLoadSubsetDemandKey(singleton)])
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const scanRows = storage.adapter.scanRows!
    let metadataOnlyScans = 0
    storage.adapter.scanRows = (target, options, context) => {
      if (options?.metadataOnly) metadataOnlyScans++
      return scanRows(target, options, context)
    }
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [shared],
    )
    await collection.stateWhenReady()
    await collection._sync.loadSubset(singleton)
    await vi.waitFor(() => {
      const snapshot = storage.snapshot()
      expect(storedItems(storage)).toEqual([shared])
      expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual([
        currentHash,
      ])
      expect(snapshot.collectionMetadata.size).toBe(0)
      expect(rows(collection)).toEqual([shared.id])
    })
    expect(queryFn).toHaveBeenCalledTimes(1)

    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `detail`),
    })
    expect(metadataOnlyScans).toBe(1)

    collection._sync.unloadSubset(singleton)
    await vi.waitFor(() => {
      const snapshot = storage.snapshot()
      expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual([
        currentHash,
      ])
      expect([...snapshot.collectionMetadata.keys()]).toEqual([
        `queryCollection:gc:${currentHash}`,
      ])
    })
  })

  it(`revalidates an old singleton owner when an equal current demand loads first`, async () => {
    const id = `pre-upgrade-singleton-after-equality`
    const singleton = {
      where: new IR.Func(`in`, [
        new IR.PropRef([`category`]),
        new IR.Value([`shared`]),
      ]),
    }
    const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const oldDemandKey = legacySingletonCategoryDemandKey
    const oldHash = hashKey([id, oldDemandKey])
    expect(getLoadSubsetDemandKey(singleton)).toBe(
      getLoadSubsetDemandKey(equality),
    )
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )
    queryFn.mockResolvedValue([])
    await collection.stateWhenReady()
    await collection._sync.loadSubset(equality)
    expect(queryFn).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      const snapshot = storage.snapshot()
      expect(storedItems(storage)).toEqual([])
      expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual([])
      expect(snapshot.collectionMetadata.size).toBe(0)
      expect(rows(collection)).toEqual([])
    })

    await collection._sync.loadSubset(singleton)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * The independent ownership graph has one historical limit-1 owner. A
   * limit-2 request has a different window, even when its singleton-IN
   * predicate normalizes to equality. Its empty result cannot retire the
   * limit-1 edge. The later limit-1 result can. This history drives the real
   * persisted owner matcher and compares durable rows, owner, and marker at
   * each applied subset settlement.
   */
  it(`keeps a historical window owner until its own window revalidates`, async () => {
    const id = `historical-singleton-window-owner`
    const oldDemandKey = `${legacySingletonCategoryDemandKey.slice(0, -1)},"limit":["number",1]}`
    const oldHash = hashKey([id, oldDemandKey])
    const where = eq(new IR.PropRef([`category`]), `shared`)
    const narrow = { where, limit: 1 }
    const wider = { where, limit: 2 }
    expect(
      getLegacyLoadSubsetDemandKey({
        where: new IR.Func(`in`, [
          new IR.PropRef([`category`]),
          new IR.Value([`shared`]),
        ]),
        limit: 1,
      }),
    ).toBe(oldDemandKey)
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )

    await collection.stateWhenReady()
    await collection._sync.loadSubset(wider)
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(storedItems(storage)).toEqual([shared])
    expect(persistedOwners(storage.snapshot().rowMetadata, shared.id)).toEqual([
      oldHash,
    ])
    expect([...storage.snapshot().collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${oldHash}`,
    ])

    await collection._sync.loadSubset(narrow)
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(storedItems(storage)).toEqual([])
    expect(persistedOwners(storage.snapshot().rowMetadata, shared.id)).toEqual(
      [],
    )
    expect(storage.snapshot().collectionMetadata.size).toBe(0)
  })

  /**
   * On-demand absence claims belong to the fetched Query scope. A complete,
   * applied full-source result keeps its own row and owner but does not retire
   * a historical filtered owner's durable edge merely because that row is
   * absent from the full result.
   * Once that filtered demand is acquired, its old owner must be reconciled
   * before the acquisition settles. An implementation may fetch the exact
   * subset or reconcile it from authoritative full-source rows; the public
   * and durable result is the same. An interrupted unload can leave an old
   * owner without a retention marker, so both metadata shapes are legal.
   * The unrelated full-source row survives.
   */
  it.each([{ marker: false }, { marker: true }])(
    `reconciles a historical filtered owner beside an applied full source, marker=$marker`,
    async ({ marker }) => {
      const id = `pre-upgrade-singleton-beside-full-source-${marker}`
      const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
      const fullHash = hashKey([id])
      const filtered = { where: eq(new IR.PropRef([`category`]), `shared`) }
      const storage = createOwnershipStorage({
        rows: new Map([[shared.id, shared]]),
        rowMetadata: new Map([
          [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
        ]),
        collectionMetadata: new Map(
          marker
            ? [
                [
                  `queryCollection:gc:${oldHash}`,
                  { queryHash: oldHash, mode: `until-revalidated` },
                ],
              ]
            : [],
        ),
      })
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        [detailOnly],
      )
      await collection.stateWhenReady()
      await collection._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(rows(collection)).toEqual([detailOnly.id, shared.id])
      expect(
        persistedOwners(storage.snapshot().rowMetadata, detailOnly.id),
      ).toEqual([fullHash])
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([oldHash])
      expect([...storage.snapshot().collectionMetadata.keys()]).toEqual(
        marker ? [`queryCollection:gc:${oldHash}`] : [],
      )

      await collection._sync.loadSubset(filtered)
      // Successful subset settlement includes publication of its result.
      expect(rows(collection)).toEqual([detailOnly.id])
      await vi.waitFor(() => {
        const snapshot = storage.snapshot()
        expect(storedItems(storage)).toEqual([detailOnly])
        expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual([])
        expect(persistedOwners(snapshot.rowMetadata, detailOnly.id)).toEqual([
          fullHash,
        ])
        expect(snapshot.collectionMetadata.size).toBe(0)
      })
    },
  )

  /**
   * A cached current-key result is not evidence that a historical owner has
   * revalidated. The old singleton-IN row and marker survive until the new EQ
   * demand's physical empty result applies. The held response distinguishes
   * fetching from early publication of stale cached data.
   */
  it(`revalidates a historical singleton owner before using a warm equal Query`, async () => {
    const id = `pre-upgrade-singleton-warm-cache`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [])
    const cached: Item = {
      id: `other-shared`,
      category: `shared`,
      name: `Old cached`,
    }
    const provider = createDeferred<Array<Item>>()
    queryFn.mockReturnValue(provider.promise)
    await collection.stateWhenReady()
    queryClient.setQueryData([id, getLoadSubsetDemandKey(equality)], [cached])

    const load = collection._sync.loadSubset(equality)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    const peerLoad = collection._sync.loadSubset(equality)
    let settledLoads = 0
    void Promise.resolve(load).then(() => settledLoads++)
    void Promise.resolve(peerLoad).then(() => settledLoads++)
    await Promise.resolve()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(settledLoads).toBe(0)
    expect(storedItems(storage)).toEqual([shared])
    expect(persistedOwners(storage.snapshot().rowMetadata, shared.id)).toEqual([
      oldHash,
    ])
    expect([...storage.snapshot().collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${oldHash}`,
    ])
    expect(rows(collection)).not.toContain(cached.id)

    provider.resolve([])
    await Promise.all([load, peerLoad])
    expect(settledLoads).toBe(2)
    await vi.waitFor(() => {
      expect(storedItems(storage)).toEqual([])
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([])
      expect(storage.snapshot().collectionMetadata.size).toBe(0)
      expect(rows(collection)).toEqual([])
    })
  })

  /**
   * A released observer lease cannot cancel a peer's shared revalidation.
   * The durable old owner remains until the surviving load's result applies.
   */
  it(`keeps a shared historical revalidation when one equal demand unloads`, async () => {
    const id = `pre-upgrade-singleton-peer-survives`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const first = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const currentHash = hashKey([id, getLoadSubsetDemandKey(first)])
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [])
    const provider = createDeferred<Array<Item>>()
    queryFn.mockReturnValue(provider.promise)
    const peer = { where: eq(new IR.PropRef([`category`]), `shared`) }
    await collection.stateWhenReady()
    queryClient.setQueryData([id, getLoadSubsetDemandKey(first)], [shared])

    const firstOutcome = Promise.resolve(
      collection._sync.loadSubset(first),
    ).then(
      () => `ready`,
      (error: unknown) => (error as Error).name,
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    const peerLoad = collection._sync.loadSubset(peer)
    collection._sync.unloadSubset(first)
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(persistedOwners(storage.snapshot().rowMetadata, shared.id)).toEqual([
      oldHash,
    ])

    provider.resolve([shared])
    await peerLoad
    await firstOutcome
    await vi.waitFor(() => {
      expect(storedItems(storage)).toEqual([shared])
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([currentHash])
      expect(storage.snapshot().collectionMetadata.size).toBe(0)
      expect(rows(collection)).toEqual([shared.id])
    })
    expect(queryFn).toHaveBeenCalledTimes(1)
    collection._sync.unloadSubset(peer)
    expect(storedItems(storage)).toEqual([shared])
    expect([...storage.snapshot().collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${currentHash}`,
    ])
  })

  /**
   * A request aborted while the persisted-owner scan is held has no surviving
   * logical owner. The scan only discovers historical keys; it cannot authorize
   * a later provider request or retire durable ownership. The legal history is
   * acquire, hold metadata scan, abort, then release the scan. At the provider
   * and public-row checkpoints, no fetch or publication is allowed, and the
   * historical durable row and marker still belong to their old owner.
   */
  it(`does not resume an aborted request after the persisted-owner scan`, async () => {
    const id = `aborted-historical-owner-scan`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const queryClient = createQueryClient()
    const scanEntered = createDeferred<void>()
    const releaseScan = createDeferred<void>()
    const late: Item = { id: `late`, category: `shared`, name: `Late` }
    const queryFn = vi.fn(() => Promise.resolve([late]))
    const queryOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      persistedGcTime: Number.POSITIVE_INFINITY,
    })
    const originalSync = queryOptions.sync.sync
    const source = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...queryOptions,
        sync: {
          ...queryOptions.sync,
          sync: (params) => {
            const metadata = params.metadata!
            const persistence = metadata.persistence!
            return originalSync({
              ...params,
              metadata: {
                ...metadata,
                persistence: {
                  ...persistence,
                  scanPersistedRows: async (...args) => {
                    if (args[0]?.metadataOnly) {
                      scanEntered.resolve()
                      await releaseScan.promise
                    }
                    return persistence.scanPersistedRows(...args)
                  },
                },
              },
            })
          },
        },
        persistence: { adapter: storage.adapter },
      }),
    )
    const subscription = source.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    cleanups.push(async () => {
      releaseScan.resolve()
      subscription.unsubscribe()
      await source.cleanup()
      queryClient.clear()
    })
    await source.stateWhenReady()
    const controller = new AbortController()
    let load: Promise<string> | undefined
    expect(
      subscription.requestSnapshot({
        where: eq(new IR.PropRef([`category`]), `shared`),
        signal: controller.signal,
        onLoadSubsetResult: (result) => {
          load = Promise.resolve(result).then(
            () => `fulfilled`,
            (error: unknown) =>
              error instanceof Error ? error.name : `unknown rejection`,
          )
        },
      }),
    ).toBe(true)
    await scanEntered.promise
    controller.abort()
    releaseScan.resolve()
    expect(await load).toBe(`AbortError`)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(queryFn).not.toHaveBeenCalled()
    expect(source.has(late.id)).toBe(false)
    const durable = storage.snapshot()
    expect([...durable.rows.values()]).toEqual([shared])
    expect(persistedOwners(durable.rowMetadata, shared.id)).toEqual([oldHash])
    expect([...durable.collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${oldHash}`,
    ])
  })

  /**
   * An ordinary unload retires the first acquisition while its provider
   * ignores cancellation. Query Core may keep that response for a successor
   * or start another fetch. Before either response, the historical owner must
   * remain durable and the successor must wait. After settlement, its public
   * row and durable owner must agree with whichever response became current.
   */
  it(`keeps a historical owner until a reacquired demand receives a result`, async () => {
    const id = `pre-upgrade-singleton-immediate-reacquire`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const currentHash = hashKey([id, getLoadSubsetDemandKey(equality)])
    const fresh: Item = { id: `fresh`, category: `shared`, name: `Fresh` }
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [])
    const firstResult = createDeferred<Array<Item>>()
    const secondResult = createDeferred<Array<Item>>()
    queryFn
      .mockImplementationOnce(() => firstResult.promise)
      .mockImplementationOnce(() => secondResult.promise)
    await collection.stateWhenReady()
    queryClient.setQueryData([id, getLoadSubsetDemandKey(equality)], [shared])

    const firstLoad = Promise.resolve(
      collection._sync.loadSubset(equality),
    ).then(
      () => `ready`,
      (error: unknown) => (error as Error).name,
    )
    let firstSettled = false
    void firstLoad.then(() => (firstSettled = true))
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    expect(firstSettled).toBe(false)
    collection._sync.unloadSubset(equality)
    expect(persistedOwners(storage.snapshot().rowMetadata, shared.id)).toEqual([
      oldHash,
    ])
    const replacement = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const nextLoad = collection._sync.loadSubset(replacement)
    let nextSettled = false
    void Promise.resolve(nextLoad).then(
      () => (nextSettled = true),
      () => (nextSettled = true),
    )
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    expect(nextSettled).toBe(false)
    expect(persistedOwners(storage.snapshot().rowMetadata, shared.id)).toEqual([
      oldHash,
    ])

    firstResult.resolve([fresh])
    await vi.waitFor(() =>
      expect(nextSettled || queryFn.mock.calls.length === 2).toBe(true),
    )
    secondResult.resolve([])
    await expect(nextLoad).resolves.toBeUndefined()
    await firstLoad
    await vi.waitFor(() => {
      const observed = {
        cache: queryClient.getQueryData([id, getLoadSubsetDemandKey(equality)]),
        stored: storedItems(storage),
        publicRows: rows(collection),
        oldOwners: persistedOwners(storage.snapshot().rowMetadata, shared.id),
        freshOwners: persistedOwners(storage.snapshot().rowMetadata, fresh.id),
        markers: storage.snapshot().collectionMetadata.size,
      }
      expect([
        {
          cache: [fresh],
          stored: [fresh],
          publicRows: [fresh.id],
          oldOwners: [],
          freshOwners: [currentHash],
          markers: 0,
        },
        {
          cache: [],
          stored: [],
          publicRows: [],
          oldOwners: [],
          freshOwners: [],
          markers: 0,
        },
      ]).toContainEqual(observed)
    })
  })

  /**
   * A caller's abort settles only that caller. A's F1 rejection cannot make
   * B's load ready or retire the historical row, owner, and marker while B's
   * replacement responses are held. Query Core may start another physical
   * attempt after cancellation; the provider holds every attempt after F1.
   * The ownership graph keeps the old edge at this cut. An applied empty
   * replacement result retires it; a failed one leaves it intact. The
   * controlled provider and durable store expose both checkpoints through
   * the real QueryClient and on-demand loadSubset path.
   */
  it.each([`success`, `failure`] as const)(
    `rejects an aborted historical owner while its successor revalidates: replacement %s`,
    async (outcome) => {
      const id = `pre-upgrade-singleton-aborted-reacquire-${outcome}`
      const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
      const firstAbort = new AbortController()
      const firstOptions = {
        where: eq(new IR.PropRef([`category`]), `shared`),
        signal: firstAbort.signal,
      }
      const storage = createOwnershipStorage({
        rows: new Map([[shared.id, shared]]),
        rowMetadata: new Map([
          [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
        ]),
        collectionMetadata: new Map([
          [
            `queryCollection:gc:${oldHash}`,
            { queryHash: oldHash, mode: `until-revalidated` },
          ],
        ]),
      })
      const { collection, queryClient, queryFn } =
        createPersistedOwnershipFixture(id, storage, [])
      const firstResult = createDeferred<Array<Item>>()
      const replacementResult = createDeferred<Array<Item>>()
      let physicalSignal: AbortSignal | undefined
      queryFn
        .mockImplementationOnce((context: QueryFunctionContext) => {
          physicalSignal = context.meta?.loadSubsetOptions?.signal
          physicalSignal?.addEventListener(
            `abort`,
            () => firstResult.reject(new Error(`first fetch aborted`)),
            { once: true },
          )
          return firstResult.promise
        })
        .mockImplementation(() => replacementResult.promise)
      await collection.stateWhenReady()
      queryClient.setQueryData(
        [id, getLoadSubsetDemandKey(firstOptions)],
        [shared],
      )

      const firstOperation = collection._sync.loadSubset(firstOptions)
      expect(firstOperation).not.toBe(true)
      const firstLoad = Promise.resolve(firstOperation).then(
        () => `ready`,
        (error: unknown) => (error as Error).name,
      )
      let firstSettled = false
      void firstLoad.then(() => (firstSettled = true))
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      expect(firstSettled).toBe(false)
      firstAbort.abort()
      collection._sync.unloadSubset(firstOptions)
      expect(physicalSignal?.aborted).toBe(true)
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([oldHash])

      const secondOptions = {
        where: eq(new IR.PropRef([`category`]), `shared`),
      }
      const secondLoad = collection._sync.loadSubset(secondOptions)
      const secondOutcome = Promise.resolve(secondLoad).then(
        () => `ready`,
        (error: unknown) => (error as Error).message,
      )
      let secondSettled = false
      void secondOutcome.then(() => (secondSettled = true))
      try {
        await vi.waitFor(() =>
          expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(2),
        )
        // A settles while the replacement provider still holds F2. The graph
        // predicts that no successful replacement has retired the old edge.
        await vi.waitFor(() => expect(firstSettled).toBe(true))
        expect(await firstLoad).toBe(`AbortError`)
        const held = storage.snapshot()
        expect
          .soft({
            secondSettled,
            stored: storedItems(storage),
            publicRows: rows(collection),
            owners: persistedOwners(held.rowMetadata, shared.id),
            marker: held.collectionMetadata.get(
              `queryCollection:gc:${oldHash}`,
            ),
          })
          .toEqual({
            secondSettled: false,
            stored: [shared],
            publicRows: [shared.id],
            owners: [oldHash],
            marker: { queryHash: oldHash, mode: `until-revalidated` },
          })

        if (outcome === `success`) {
          replacementResult.resolve([])
          expect(await secondOutcome).toBe(`ready`)
          await vi.waitFor(() => {
            expect(rows(collection)).toEqual([])
            expect(storedItems(storage)).toEqual([])
            expect(
              persistedOwners(storage.snapshot().rowMetadata, shared.id),
            ).toEqual([])
            expect(storage.snapshot().collectionMetadata.size).toBe(0)
          })
        } else {
          replacementResult.reject(new Error(`replacement failed`))
          const settled = await secondOutcome
          const failed = storage.snapshot()
          expect({
            outcome: settled,
            stored: storedItems(storage),
            publicRows: rows(collection),
            owners: persistedOwners(failed.rowMetadata, shared.id),
            marker: failed.collectionMetadata.get(
              `queryCollection:gc:${oldHash}`,
            ),
          }).toEqual({
            outcome: `replacement failed`,
            stored: [shared],
            publicRows: [shared.id],
            owners: [oldHash],
            marker: { queryHash: oldHash, mode: `until-revalidated` },
          })
        }
      } finally {
        replacementResult.resolve([])
        collection._sync.unloadSubset(secondOptions)
      }
    },
  )

  /**
   * Public live-query preload owns the acquisition lease. Retiring its final
   * owner rejects that preload before either endpoint settles. A new live
   * query must wait for a new result, then replace the old durable owner.
   */
  it(`retires a public preload before remounting a persisted historical owner`, async () => {
    const id = `pre-upgrade-singleton-live-remount`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const currentHash = hashKey([id, getLoadSubsetDemandKey(equality)])
    const fresh: Item = { id: `fresh`, category: `shared`, name: `Fresh` }
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [])
    const firstResult = createDeferred<Array<Item>>()
    const secondResult = createDeferred<Array<Item>>()
    const firstStarted = createDeferred<void>()
    let firstSignal: AbortSignal | undefined
    queryFn
      .mockImplementationOnce((context: QueryFunctionContext) => {
        firstSignal = context.signal
        firstStarted.resolve()
        return firstResult.promise
      })
      .mockImplementationOnce(() => secondResult.promise)
    await collection.stateWhenReady()
    queryClient.setQueryData([id, getLoadSubsetDemandKey(equality)], [shared])
    const buildLive = () =>
      createLiveQueryCollection((query) =>
        query
          .from({ item: collection })
          .where(({ item }) => eq(item.category, `shared`))
          .select(({ item }) => ({ id: item.id, name: item.name })),
      )
    const first = buildLive()
    let second: ReturnType<typeof buildLive> | undefined
    try {
      const firstOutcome = first.preload().then(
        () => `ready`,
        (error: unknown) => (error as Error).name,
      )
      await firstStarted.promise
      expect(firstSignal?.aborted).toBe(false)
      await first.cleanup()
      expect(await firstOutcome).toBe(`AbortError`)
      expect(firstSignal?.aborted).toBe(true)
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([oldHash])

      second = buildLive()
      const secondLoad = second.preload()
      let secondSettled = false
      void secondLoad.then(
        () => (secondSettled = true),
        () => (secondSettled = true),
      )
      for (let turn = 0; turn < 5; turn++) await Promise.resolve()
      expect(secondSettled).toBe(false)
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([oldHash])
      firstResult.resolve([shared])
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      for (let turn = 0; turn < 5; turn++) await Promise.resolve()
      expect(secondSettled).toBe(false)
      expect(
        persistedOwners(storage.snapshot().rowMetadata, shared.id),
      ).toEqual([oldHash])

      secondResult.resolve([fresh])
      await secondLoad
      await vi.waitFor(() => {
        expect(storedItems(storage)).toEqual([fresh])
        expect(
          persistedOwners(storage.snapshot().rowMetadata, fresh.id),
        ).toEqual([currentHash])
        expect(storage.snapshot().collectionMetadata.size).toBe(0)
        expect(rows(collection)).toEqual([fresh.id])
        expect(rows(second!)).toEqual([fresh.id])
      })
    } finally {
      firstResult.resolve([])
      secondResult.resolve([])
      await first.cleanup()
      await second?.cleanup()
    }
  })

  it.each([false, true])(
    `keeps a pre-upgrade singleton owner after failed revalidation, marker=$marker`,
    async (marker) => {
      const id = `pre-upgrade-singleton-revalidation-fails-${marker}`
      const singleton = {
        where: new IR.Func(`in`, [
          new IR.PropRef([`category`]),
          new IR.Value([`shared`]),
        ]),
      }
      const oldDemandKey = legacySingletonCategoryDemandKey
      const oldHash = hashKey([id, oldDemandKey])
      const storage = createOwnershipStorage({
        rows: new Map([[shared.id, shared]]),
        rowMetadata: new Map([
          [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
        ]),
        collectionMetadata: new Map(
          marker
            ? [
                [
                  `queryCollection:gc:${oldHash}`,
                  { queryHash: oldHash, mode: `until-revalidated` },
                ],
              ]
            : [],
        ),
      })
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        [],
      )
      queryFn.mockRejectedValueOnce(new Error(`provider failed`))
      await collection.stateWhenReady()
      await expect(collection._sync.loadSubset(singleton)).rejects.toThrow(
        `provider failed`,
      )
      expect(queryFn).toHaveBeenCalledTimes(1)
      const snapshot = storage.snapshot()
      expect(storedItems(storage)).toEqual([shared])
      expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual([
        oldHash,
      ])
      expect([...snapshot.collectionMetadata.keys()]).toEqual(
        marker ? [`queryCollection:gc:${oldHash}`] : [],
      )

      await collection._sync.loadSubset(singleton)
      expect(queryFn).toHaveBeenCalledTimes(2)
      await vi.waitFor(() => {
        const applied = storage.snapshot()
        expect(storedItems(storage)).toEqual([])
        expect(persistedOwners(applied.rowMetadata, shared.id)).toEqual([])
        expect(applied.collectionMetadata.size).toBe(0)
        expect(rows(collection)).toEqual([])
      })
    },
  )

  /**
   * Failed revalidation preserves the old owner at the failure cut. Final
   * unload renews the finite retention window for that old edge just as it
   * does for the current key. The old edge then expires at the new deadline.
   */
  it.each([`historical`, `current`] as const)(
    `expires a $kind singleton owner at its renewed TTL after failed revalidation`,
    async (kind) => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_000)
        const id = `singleton-failed-ttl-${kind}`
        const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
        const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
        const currentHash = hashKey([id, getLoadSubsetDemandKey(equality)])
        const ownerHash = kind === `historical` ? oldHash : currentHash
        const storage = createOwnershipStorage({
          rows: new Map([[shared.id, shared]]),
          rowMetadata: new Map([
            [shared.id, { queryCollection: { owners: { [ownerHash]: true } } }],
          ]),
          collectionMetadata: new Map([
            [
              `queryCollection:gc:${ownerHash}`,
              { queryHash: ownerHash, mode: `ttl`, expiresAt: 1_050 },
            ],
          ]),
        })
        const { collection, queryFn } = createPersistedOwnershipFixture(
          id,
          storage,
          [],
          `on-demand`,
          100,
        )
        queryFn.mockRejectedValueOnce(new Error(`provider failed`))
        await collection.stateWhenReady()
        await expect(collection._sync.loadSubset(equality)).rejects.toThrow(
          `provider failed`,
        )
        expect(
          persistedOwners(storage.snapshot().rowMetadata, shared.id),
        ).toEqual([ownerHash])
        expect(rows(collection)).toEqual([shared.id])
        collection._sync.unloadSubset(equality)
        expect(
          storage
            .snapshot()
            .collectionMetadata.get(`queryCollection:gc:${ownerHash}`),
        ).toEqual({ queryHash: ownerHash, mode: `ttl`, expiresAt: 1_100 })

        await vi.advanceTimersByTimeAsync(50)
        expect(storedItems(storage)).toEqual([shared])
        expect(
          persistedOwners(storage.snapshot().rowMetadata, shared.id),
        ).toEqual([ownerHash])
        expect(rows(collection)).toEqual([shared.id])
        await vi.advanceTimersByTimeAsync(50)
        expect(storedItems(storage)).toEqual([])
        expect(
          persistedOwners(storage.snapshot().rowMetadata, shared.id),
        ).toEqual([])
        expect(
          storage
            .snapshot()
            .collectionMetadata.has(`queryCollection:gc:${ownerHash}`),
        ).toBe(false)
        expect(rows(collection)).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    },
  )

  /** A held-scan assertion stays primary even when both local releases fail. */
  it(`preserves a held-scan comparison failure through local cleanup`, async () => {
    const comparison = new Error(`row ownership mismatch`)
    const firstCleanup = new Error(`first cleanup failed`)
    const secondCleanup = new Error(`second cleanup failed`)
    const attempted: Array<string> = []
    await expect(
      cleanupAfterCheck({ reason: comparison }, [
        () => {
          attempted.push(`first`)
          throw firstCleanup
        },
        () => {
          attempted.push(`second`)
          return Promise.reject(secondCleanup)
        },
        () => {
          attempted.push(`third`)
        },
      ]),
    ).rejects.toMatchObject({
      cause: comparison,
      errors: [comparison, firstCleanup, secondCleanup],
    })
    expect(attempted).toEqual([`first`, `second`, `third`])
  })

  /**
   * A live demand begins while a matching owner's TTL is still valid. Its
   * metadata scan has not finished when that deadline passes, so a historical
   * or current owner stays durable until revalidation can replace its result.
   * The provider result is held to observe rows at the deadline and again
   * after scan delivery, before application. A failed scan leaves no acquired
   * claim and permits the expired edge to retire.
   */
  it.each(
    ([`historical`, `current`] as const).flatMap((ownerKind) =>
      ([`success`, `failure`] as const).map((scanOutcome) => ({
        ownerKind,
        scanOutcome,
      })),
    ),
  )(
    `settles a $ownerKind singleton owner after a live demand scans past its TTL, scan=$scanOutcome`,
    async ({ ownerKind, scanOutcome }) => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_000)
        const id = `singleton-${ownerKind}-scan-crosses-ttl-${scanOutcome}`
        const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
        const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
        const currentHash = hashKey([id, getLoadSubsetDemandKey(equality)])
        const ownerHash = ownerKind === `historical` ? oldHash : currentHash
        const marker = `queryCollection:gc:${ownerHash}`
        const storage = createOwnershipStorage({
          rows: new Map([[shared.id, shared]]),
          rowMetadata: new Map([
            [shared.id, { queryCollection: { owners: { [ownerHash]: true } } }],
          ]),
          collectionMetadata: new Map([
            [marker, { queryHash: ownerHash, mode: `ttl`, expiresAt: 1_050 }],
          ]),
        })
        const scanRows = storage.adapter.scanRows!
        const scanEntered = createDeferred<void>()
        const releaseScan = createDeferred<void>()
        storage.adapter.scanRows = (target, options, context) => {
          if (options?.metadataOnly) {
            scanEntered.resolve()
            return releaseScan.promise.then(() =>
              scanRows(target, options, context),
            )
          }
          return scanRows(target, options, context)
        }
        const { collection, queryFn } = createPersistedOwnershipFixture(
          id,
          storage,
          [],
          `on-demand`,
          100,
        )
        const providerResult = createDeferred<Array<Item>>()
        queryFn.mockImplementationOnce(() => providerResult.promise)
        await collection.stateWhenReady()
        const live = createLiveQueryCollection((query) =>
          query
            .from({ item: collection })
            .where(({ item }) => eq(item.category, `shared`))
            .select(({ item }) => ({ id: item.id, name: item.name })),
        )
        let checkFailure: { reason: unknown } | undefined
        try {
          const preload = live.preload()
          await scanEntered.promise
          expect(rows(live)).toEqual([shared.id])
          await vi.advanceTimersByTimeAsync(50)
          for (let turn = 0; turn < 20; turn++) await Promise.resolve()
          expect(rows(collection)).toEqual([shared.id])
          expect(rows(live)).toEqual([shared.id])
          expect(storedItems(storage)).toEqual([shared])
          expect(
            persistedOwners(storage.snapshot().rowMetadata, shared.id),
          ).toEqual([ownerHash])
          expect(storage.snapshot().collectionMetadata.has(marker)).toBe(true)
          expect(queryFn).toHaveBeenCalledTimes(0)

          if (scanOutcome === `failure`) {
            releaseScan.reject(new Error(`persisted scan failed`))
            await expect(preload).rejects.toThrow(`persisted scan failed`)
            await vi.waitFor(() => {
              expect(rows(collection)).toEqual([])
              expect(storedItems(storage)).toEqual([])
              expect(storage.snapshot().collectionMetadata.has(marker)).toBe(
                false,
              )
            })
            expect(queryFn).toHaveBeenCalledTimes(0)
            return
          }
          releaseScan.resolve()
          await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
          expect(rows(collection)).toEqual([shared.id])
          expect(rows(live)).toEqual([shared.id])
          expect(storedItems(storage)).toEqual([shared])
          expect(
            persistedOwners(storage.snapshot().rowMetadata, shared.id),
          ).toEqual([ownerHash])
          expect(storage.snapshot().collectionMetadata.has(marker)).toBe(true)

          providerResult.resolve([shared])
          await preload
          await vi.waitFor(() => {
            expect(rows(collection)).toEqual([shared.id])
            expect(rows(live)).toEqual([shared.id])
            expect(
              persistedOwners(storage.snapshot().rowMetadata, shared.id),
            ).toEqual([currentHash])
            expect(storage.snapshot().collectionMetadata.has(marker)).toBe(
              false,
            )
          })
        } catch (error) {
          checkFailure = { reason: error }
          throw error
        } finally {
          await cleanupAfterCheck(checkFailure, [
            () => releaseScan.resolve(),
            () => providerResult.resolve([]),
            () => live.cleanup(),
          ])
        }
      } finally {
        vi.useRealTimers()
      }
    },
  )

  /**
   * A pending alias scan protects its matching historical owner, not an
   * unrelated owner's expired TTL. The independent detail row remains only
   * in storage and must retire there at its deadline while the shared-row
   * preload still waits for its metadata scan and provider result.
   */
  it(`expires an unrelated owner while a historical alias scan is held`, async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const id = `singleton-alias-scan-unrelated-ttl`
      const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
      const detailDemand = {
        where: eq(new IR.PropRef([`category`]), `detail`),
      }
      const detailHash = hashKey([id, getLoadSubsetDemandKey(detailDemand)])
      const sharedMarker = `queryCollection:gc:${oldHash}`
      const detailMarker = `queryCollection:gc:${detailHash}`
      const storage = createOwnershipStorage({
        rows: new Map([
          [shared.id, shared],
          [detailOnly.id, detailOnly],
        ]),
        rowMetadata: new Map([
          [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
          [
            detailOnly.id,
            { queryCollection: { owners: { [detailHash]: true } } },
          ],
        ]),
        collectionMetadata: new Map([
          [sharedMarker, { queryHash: oldHash, mode: `ttl`, expiresAt: 1_050 }],
          [
            detailMarker,
            { queryHash: detailHash, mode: `ttl`, expiresAt: 1_050 },
          ],
        ]),
      })
      const scanEntered = createDeferred<void>()
      const releaseScan = createDeferred<void>()
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        [],
        `on-demand`,
        100,
        undefined,
        { entered: () => scanEntered.resolve(), released: releaseScan.promise },
      )
      const providerResult = createDeferred<Array<Item>>()
      queryFn.mockImplementationOnce(() => providerResult.promise)
      await collection.stateWhenReady()
      expect(Date.now()).toBe(1_000)
      expect(storedItems(storage)).toEqual([detailOnly, shared])
      const live = createLiveQueryCollection((query) =>
        query
          .from({ item: collection })
          .where(({ item }) => eq(item.category, `shared`))
          .select(({ item }) => ({ id: item.id, name: item.name })),
      )
      let checkFailure: { reason: unknown } | undefined
      try {
        const preload = live.preload()
        await scanEntered.promise
        expect(rows(collection)).toEqual([shared.id])
        await vi.advanceTimersByTimeAsync(50)
        await vi.waitFor(() => {
          expect(storedItems(storage)).toEqual([shared])
          expect(storage.snapshot().collectionMetadata.has(detailMarker)).toBe(
            false,
          )
        })
        expect(rows(collection)).toEqual([shared.id])
        expect(rows(live)).toEqual([shared.id])
        expect(storage.snapshot().collectionMetadata.has(sharedMarker)).toBe(
          true,
        )
        expect(queryFn).toHaveBeenCalledTimes(0)

        releaseScan.resolve()
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
        providerResult.resolve([shared])
        await preload
      } catch (error) {
        checkFailure = { reason: error }
        throw error
      } finally {
        await cleanupAfterCheck(checkFailure, [
          () => releaseScan.resolve(),
          () => providerResult.resolve([]),
          () => live.cleanup(),
        ])
      }
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * A released or aborted acquisition no longer protects a historical owner,
   * whether it leaves before or after the timer fires. The metadata scan may
   * still be awaiting delivery, but the expired row and marker must retire
   * without starting a provider request. Unload removes the pending token;
   * signal abort leaves its token until the scan continuation runs.
   */
  it.each(
    ([`unload`, `signal`] as const).flatMap((release) =>
      ([`before`, `after`] as const).map((timer) => ({ release, timer })),
    ),
  )(
    `expires a historical owner after $release $timer its timer fires during a held alias scan`,
    async ({ release, timer }) => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_000)
        const id = `singleton-alias-scan-${release}-${timer}-ttl`
        const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
        const marker = `queryCollection:gc:${oldHash}`
        const storage = createOwnershipStorage({
          rows: new Map([[shared.id, shared]]),
          rowMetadata: new Map([
            [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
          ]),
          collectionMetadata: new Map([
            [marker, { queryHash: oldHash, mode: `ttl`, expiresAt: 1_050 }],
          ]),
        })
        const scanEntered = createDeferred<void>()
        const releaseScan = createDeferred<void>()
        const { collection, queryFn } = createPersistedOwnershipFixture(
          id,
          storage,
          [],
          `on-demand`,
          100,
          undefined,
          {
            entered: () => scanEntered.resolve(),
            released: releaseScan.promise,
          },
        )
        await collection.stateWhenReady()
        const controller = new AbortController()
        const live =
          release === `unload`
            ? createLiveQueryCollection((query) =>
                query
                  .from({ item: collection })
                  .where(({ item }) => eq(item.category, `shared`))
                  .select(({ item }) => ({ id: item.id, name: item.name })),
              )
            : undefined
        let checkFailure: { reason: unknown } | undefined
        try {
          const load = Promise.resolve(
            live
              ? live.preload()
              : collection._sync.loadSubset({
                  where: eq(new IR.PropRef([`category`]), `shared`),
                  signal: controller.signal,
                }),
          ).then(
            () => `fulfilled`,
            (error: unknown) => (error as Error).name,
          )
          await scanEntered.promise
          if (timer === `before`) {
            if (live) await live.cleanup()
            else controller.abort()
          }
          await vi.advanceTimersByTimeAsync(50)
          if (timer === `after`) {
            expect(storedItems(storage)).toEqual([shared])
            expect(storage.snapshot().collectionMetadata.has(marker)).toBe(true)
            if (live) await live.cleanup()
            else controller.abort()
          }
          await vi.waitFor(() => {
            expect(storedItems(storage)).toEqual([])
            expect(storage.snapshot().collectionMetadata.has(marker)).toBe(
              false,
            )
          })
          expect(queryFn).toHaveBeenCalledTimes(0)
          releaseScan.resolve()
          expect(await load).toBe(`AbortError`)
          expect(queryFn).toHaveBeenCalledTimes(0)
        } catch (error) {
          checkFailure = { reason: error }
          throw error
        } finally {
          await cleanupAfterCheck(checkFailure, [
            () => releaseScan.resolve(),
            () => live?.cleanup(),
          ])
        }
      } finally {
        vi.useRealTimers()
      }
    },
  )

  /**
   * Two equivalent live demands share alias discovery. Retiring the first
   * demand does not release the second one's claim. The old durable edge
   * stays through the TTL and provider wait, then transfers only when the
   * second demand's result applies.
   */
  it(`keeps a historical owner for a surviving peer during a held alias scan`, async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const id = `singleton-alias-scan-surviving-peer`
      const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
      const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
      const currentHash = hashKey([id, getLoadSubsetDemandKey(equality)])
      const marker = `queryCollection:gc:${oldHash}`
      const storage = createOwnershipStorage({
        rows: new Map([[shared.id, shared]]),
        rowMetadata: new Map([
          [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
        ]),
        collectionMetadata: new Map([
          [marker, { queryHash: oldHash, mode: `ttl`, expiresAt: 1_050 }],
        ]),
      })
      const scanEntered = createDeferred<void>()
      const releaseScan = createDeferred<void>()
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        [],
        `on-demand`,
        100,
        undefined,
        { entered: () => scanEntered.resolve(), released: releaseScan.promise },
      )
      const providerResult = createDeferred<Array<Item>>()
      queryFn.mockImplementationOnce(() => providerResult.promise)
      await collection.stateWhenReady()
      const buildLive = () =>
        createLiveQueryCollection((query) =>
          query
            .from({ item: collection })
            .where(({ item }) => eq(item.category, `shared`))
            .select(({ item }) => ({ id: item.id, name: item.name })),
        )
      const first = buildLive()
      const second = buildLive()
      let checkFailure: { reason: unknown } | undefined
      try {
        const retiredLoad = first.preload().then(
          () => `fulfilled`,
          (error: unknown) => (error as Error).name,
        )
        const survivingLoad = second.preload()
        await scanEntered.promise
        await vi.advanceTimersByTimeAsync(50)
        await first.cleanup()
        expect(await retiredLoad).toBe(`AbortError`)
        expect(rows(collection)).toEqual([shared.id])
        expect(rows(second)).toEqual([shared.id])
        expect(storedItems(storage)).toEqual([shared])
        expect(storage.snapshot().collectionMetadata.has(marker)).toBe(true)
        expect(queryFn).toHaveBeenCalledTimes(0)

        releaseScan.resolve()
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
        expect(storedItems(storage)).toEqual([shared])
        expect(storage.snapshot().collectionMetadata.has(marker)).toBe(true)
        providerResult.resolve([shared])
        await survivingLoad
        await vi.waitFor(() => {
          expect(rows(second)).toEqual([shared.id])
          expect(
            persistedOwners(storage.snapshot().rowMetadata, shared.id),
          ).toEqual([currentHash])
          expect(storage.snapshot().collectionMetadata.has(marker)).toBe(false)
        })
      } catch (error) {
        checkFailure = { reason: error }
        throw error
      } finally {
        await cleanupAfterCheck(checkFailure, [
          () => releaseScan.resolve(),
          () => providerResult.resolve([]),
          () => first.cleanup(),
          () => second.cleanup(),
        ])
      }
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Under the old encoder, AND(IN [shared]) and AND(IN [shared], EQ shared)
   * had two keys even though both selected this row. The new encoder reduces
   * both to AND(EQ shared). Both old edges must retire on one successful new
   * demand; a surviving source row receives exactly one current owner. This
   * crosses EQ/IN authored requests and empty/nonempty applied results.
   */
  it.each(
    ([`eq`, `in`] as const).flatMap((request) =>
      [false, true].map((rowRemains) => ({ request, rowRemains })),
    ),
  )(
    `retires both nested historical aliases with a $request request, row remains=$rowRemains`,
    async ({ request, rowRemains }) => {
      const id = `nested-historical-owners-${request}-${rowRemains}`
      const field = new IR.PropRef([`category`])
      const singleton = new IR.Func(`in`, [field, new IR.Value([`shared`])])
      const equality = eq(field, `shared`)
      const demand = {
        where: new IR.Func(`and`, [request === `eq` ? equality : singleton]),
      }
      const currentHash = hashKey([id, getLoadSubsetDemandKey(demand)])
      const oldHashes = [
        hashKey([id, legacyAndSingletonCategoryDemandKey]),
        hashKey([id, legacyAndSingletonWithEqualityDemandKey]),
      ]
      expect(new Set([currentHash, ...oldHashes]).size).toBe(3)
      const storage = createOwnershipStorage({
        rows: new Map([[shared.id, shared]]),
        rowMetadata: new Map([
          [
            shared.id,
            {
              queryCollection: {
                owners: Object.fromEntries(
                  oldHashes.map((hash) => [hash, true]),
                ),
              },
            },
          ],
        ]),
        collectionMetadata: new Map(
          oldHashes.map((hash) => [
            `queryCollection:gc:${hash}`,
            { queryHash: hash, mode: `until-revalidated` },
          ]),
        ),
      })
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        rowRemains ? [shared] : [],
      )
      await collection.stateWhenReady()
      await collection._sync.loadSubset(demand)
      expect(queryFn).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => {
        const snapshot = storage.snapshot()
        expect(storedItems(storage)).toEqual(rowRemains ? [shared] : [])
        expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual(
          rowRemains ? [currentHash] : [],
        )
        expect(snapshot.collectionMetadata.size).toBe(0)
        expect(rows(collection)).toEqual(rowRemains ? [shared.id] : [])
      })
    },
  )

  it(`preserves a malformed same-prefix owner beside a valid historical alias`, async () => {
    const id = `malformed-historical-owner`
    const validHash = hashKey([id, legacySingletonCategoryDemandKey])
    const malformedKey = legacySingletonCategoryDemandKey.replace(
      `"name":"in"`,
      `"name":"in","foreign":true`,
    )
    const malformedHash = hashKey([id, malformedKey])
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [
          shared.id,
          {
            queryCollection: {
              owners: { [validHash]: true, [malformedHash]: true },
            },
          },
        ],
      ]),
      collectionMetadata: new Map(
        [validHash, malformedHash].map((hash) => [
          `queryCollection:gc:${hash}`,
          { queryHash: hash, mode: `until-revalidated` },
        ]),
      ),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )
    await collection.stateWhenReady()
    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `shared`),
    })
    expect(queryFn).toHaveBeenCalledTimes(1)
    const snapshot = storage.snapshot()
    expect(storedItems(storage)).toEqual([shared])
    expect(persistedOwners(snapshot.rowMetadata, shared.id)).toEqual([
      malformedHash,
    ])
    expect([...snapshot.collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${malformedHash}`,
    ])
  })

  /**
   * An empty pre-upgrade proxy demand can still leave a retention marker when
   * it unloads. Its historical EQ and singleton-IN keys both name the same
   * proxy path, while the new runtime identity cannot reconstruct the old
   * object. The accepted upgrade policy clears either old marker after a
   * matching proxy-shaped demand successfully applies an empty result. A
   * genuine row-reference equality does not claim either marker.
   */
  it.each([`eq`, `in`] as const)(
    `retires both historical empty proxy markers after a matching $operator demand`,
    async (operator) => {
      const id = `empty-proxy-markers-${operator}`
      const demand = proxyCategorySubset(operator)
      const oldKey =
        operator === `eq`
          ? legacyProxyCategoryEqualityDemandKey
          : legacyProxyCategoryMembershipDemandKey
      expect(getLegacyLoadSubsetDemandKey(demand)).toBe(oldKey)
      const oldHashes = [
        hashKey([id, legacyProxyCategoryEqualityDemandKey]),
        hashKey([id, legacyProxyCategoryMembershipDemandKey]),
      ]
      const storage = createOwnershipStorage({
        rows: new Map(),
        rowMetadata: new Map(),
        collectionMetadata: new Map(
          oldHashes.map((hash) => [
            `queryCollection:gc:${hash}`,
            { queryHash: hash, mode: `until-revalidated` },
          ]),
        ),
      })
      const { collection, queryFn } = createPersistedOwnershipFixture(
        id,
        storage,
        [],
      )
      queryFn.mockResolvedValue([])
      await collection.stateWhenReady()
      await collection._sync.loadSubset(demand)
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(storedItems(storage)).toEqual([])
      expect(rows(collection)).toEqual([])
      expect(storage.snapshot().collectionMetadata.size).toBe(0)
    },
  )

  /**
   * Old literal proxy paths remain distinguishable even though old objects
   * with the same path do not. Revalidating category must retire its old
   * marker, while an old marker for other is still a separate demand. The
   * controlled store supplies both valid old markers and an empty source
   * result; compare exact durable metadata after the load applies.
   */
  it(`keeps a historical marker for a different literal proxy path`, async () => {
    const id = `empty-proxy-marker-other-path`
    const otherKey = legacyProxyCategoryEqualityDemandKey.replace(
      `"value":{"type":"ref","path":[["string","category"]]}`,
      `"value":{"type":"ref","path":[["string","other"]]}`,
    )
    const otherMember = literalProxy(`other`)
    const otherDemand: LoadSubsetOptions = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`category`]),
        new IR.Value(otherMember),
      ]),
    }
    expect(getLegacyLoadSubsetDemandKey(otherDemand)).toBe(otherKey)
    const matchingHash = hashKey([id, legacyProxyCategoryEqualityDemandKey])
    const otherHash = hashKey([id, otherKey])
    const storage = createOwnershipStorage({
      rows: new Map(),
      rowMetadata: new Map(),
      collectionMetadata: new Map(
        [matchingHash, otherHash].map((hash) => [
          `queryCollection:gc:${hash}`,
          { queryHash: hash, mode: `until-revalidated` },
        ]),
      ),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )
    queryFn.mockResolvedValue([])
    await collection.stateWhenReady()
    await collection._sync.loadSubset(proxyCategorySubset(`eq`))
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect([...storage.snapshot().collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${otherHash}`,
    ])
  })

  it(`preserves historical empty proxy markers when revalidation fails`, async () => {
    const id = `empty-proxy-markers-failed-fetch`
    const oldHashes = [
      hashKey([id, legacyProxyCategoryEqualityDemandKey]),
      hashKey([id, legacyProxyCategoryMembershipDemandKey]),
    ]
    const storage = createOwnershipStorage({
      rows: new Map(),
      rowMetadata: new Map(),
      collectionMetadata: new Map(
        oldHashes.map((hash) => [
          `queryCollection:gc:${hash}`,
          { queryHash: hash, mode: `until-revalidated` },
        ]),
      ),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )
    queryFn.mockRejectedValueOnce(new Error(`provider failed`))
    await collection.stateWhenReady()
    await expect(
      collection._sync.loadSubset(proxyCategorySubset(`eq`)),
    ).rejects.toThrow(`provider failed`)
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect([...storage.snapshot().collectionMetadata.keys()].sort()).toEqual(
      oldHashes.map((hash) => `queryCollection:gc:${hash}`).sort(),
    )
  })

  it(`does not certify a malformed retention marker as a historical owner`, async () => {
    const id = `malformed-historical-marker`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const storage = createOwnershipStorage({
      rows: new Map(),
      rowMetadata: new Map(),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: `foreign`, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )
    await collection.stateWhenReady()
    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `shared`),
    })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect([...storage.snapshot().collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${oldHash}`,
    ])
  })

  it(`keeps historical proxy markers for a genuine row-reference demand`, async () => {
    const id = `empty-proxy-markers-row-reference`
    const oldHash = hashKey([id, legacyProxyCategoryEqualityDemandKey])
    const storage = createOwnershipStorage({
      rows: new Map(),
      rowMetadata: new Map(),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryFn } = createPersistedOwnershipFixture(
      id,
      storage,
      [],
    )
    queryFn.mockResolvedValue([])
    const reference = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`category`]),
        new IR.PropRef([`category`]),
      ]),
    }
    expect(getLegacyLoadSubsetDemandKey(reference)).toBeUndefined()
    await collection.stateWhenReady()
    await collection._sync.loadSubset(reference)
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect([...storage.snapshot().collectionMetadata.keys()]).toEqual([
      `queryCollection:gc:${oldHash}`,
    ])
  })

  /**
   * The controlled owner graph above supplies the historical hash directly.
   * This receiving history writes that row, owner, and optional marker through
   * the real managed SQLite adapter, closes its driver, and opens a new driver,
   * QueryClient, and Collection on the same file. The fixed key is the exact
   * pre-upgrade singleton-IN encoding. A missing marker represents a crash
   * after owner commit but before unload. The new demand's empty source result
   * removes only its old edge at applied settlement; a peer edge keeps the row.
   * A warm current EQ cache holding a different matching row cannot replace
   * that source result or certify old-owner cleanup.
   */
  it.each(
    [false, true].flatMap((sharedRow) =>
      [false, true].flatMap((marker) =>
        [false, true].map((warmCache) => ({ sharedRow, marker, warmCache })),
      ),
    ),
  )(
    `retires the historical singleton owner after SQLite restart, shared=$sharedRow, marker=$marker, warm=$warmCache`,
    async ({ sharedRow, marker, warmCache }) => {
      const id = `sqlite-singleton-upgrade-${sharedRow}-${marker}-${warmCache}`
      const directory = mkdtempSync(join(tmpdir(), `query-key-upgrade-`))
      const filename = join(directory, `cache.sqlite`)
      let seedDriver: BetterSqlite3SQLiteDriver | undefined =
        new BetterSqlite3SQLiteDriver({ filename })
      const receiving: {
        driver?: BetterSqlite3SQLiteDriver
        queryClient?: QueryClient
        cleanupCollection?: () => Promise<void>
      } = {}
      cleanups.push(async () => {
        try {
          await receiving.cleanupCollection?.()
        } finally {
          receiving.queryClient?.clear()
          receiving.driver?.close()
          seedDriver?.close()
          rmSync(directory, { recursive: true, force: true })
        }
      })

      const singleton = {
        where: new IR.Func(`in`, [
          new IR.PropRef([`category`]),
          new IR.Value([`shared`]),
        ]),
      }
      const equality = { where: eq(new IR.PropRef([`category`]), `shared`) }
      const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
      const currentHash = hashKey([id, getLoadSubsetDemandKey(singleton)])
      const peerHash = hashKey([
        id,
        getLoadSubsetDemandKey(categorySubset(`detail`)),
      ])
      expect(currentHash).not.toBe(oldHash)
      const initialOwners = sharedRow ? [oldHash, peerHash] : [oldHash]
      const initialMarkers = [
        ...(marker ? [oldHash] : []),
        ...(sharedRow ? [peerHash] : []),
      ]
      const seedPersistence = createNodeSQLitePersistence({
        database: seedDriver.getDatabase(),
      })
      const seedClaim = await seedPersistence.adapter.claimCacheGeneration!(id)
      try {
        await seedPersistence.adapter.applyCommittedTx(
          {
            kind: `managed`,
            storageCollectionId: seedClaim.storageCollectionId,
            claimId: seedClaim.claimId,
          },
          {
            txId: `historical-owner`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            cacheGenerationClaimId: seedClaim.claimId,
            mutations: [
              {
                type: `insert`,
                key: shared.id,
                value: shared,
                metadataChanged: true,
                metadata: {
                  queryCollection: {
                    owners: Object.fromEntries(
                      initialOwners.map((hash) => [hash, true]),
                    ),
                  },
                },
              },
            ],
            collectionMetadataMutations: initialMarkers.map((hash) => ({
              type: `set` as const,
              key: `queryCollection:gc:${hash}`,
              value: { queryHash: hash, mode: `until-revalidated` },
            })),
          },
        )
      } finally {
        await seedPersistence.adapter.releaseCacheGenerationClaim!(
          seedClaim.claimId,
        )
      }
      seedDriver.close()
      seedDriver = undefined

      const receivingDriver = new BetterSqlite3SQLiteDriver({ filename })
      receiving.driver = receivingDriver
      const receivingPersistence = createNodeSQLitePersistence({
        database: receivingDriver.getDatabase(),
      })
      const managed = receivingPersistence.resolvePersistenceForCollection!({
        collectionId: id,
        mode: `sync-present`,
      })
      const queryClient = createQueryClient()
      receiving.queryClient = queryClient
      const queryFn = vi.fn(() => Promise.resolve([] as Array<Item>))
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
          persistence: managed,
        }),
      )
      receiving.cleanupCollection = () => collection.cleanup()
      const readDurable = async () => {
        const claim = await managed.adapter.claimCacheGeneration!(id)
        try {
          const snapshot = await managed.adapter.loadResumeSnapshot({
            kind: `managed`,
            storageCollectionId: claim.storageCollectionId,
            claimId: claim.claimId,
          })
          return {
            storageId: claim.storageCollectionId,
            rows: snapshot.rows.map(({ value }) => value),
            owners: persistedOwners(
              new Map(
                snapshot.rows.map(({ key, metadata }) => [key, metadata]),
              ),
              shared.id,
            ),
            markers: snapshot.collectionMetadata
              .map(({ key }) => key)
              .filter((key) => key.startsWith(`queryCollection:gc:`))
              .sort(),
          }
        } finally {
          await managed.adapter.releaseCacheGenerationClaim!(claim.claimId)
        }
      }

      await collection.stateWhenReady()
      expect(queryFn).not.toHaveBeenCalled()
      const before = await readDurable()
      expect(before.rows).toEqual([shared])
      expect(before.owners).toEqual([...initialOwners].sort())
      expect(before.markers).toEqual(
        initialMarkers.map((hash) => `queryCollection:gc:${hash}`).sort(),
      )

      if (warmCache) {
        queryClient.setQueryData(
          [id, getLoadSubsetDemandKey(equality)],
          [{ id: `other-shared`, category: `shared`, name: `Old cached` }],
        )
      }
      await collection._sync.loadSubset(warmCache ? equality : singleton)
      expect(queryFn).toHaveBeenCalledTimes(1)
      await vi.waitFor(async () => {
        const after = await readDurable()
        expect(after.storageId).toBe(before.storageId)
        expect(after.rows).toEqual(sharedRow ? [shared] : [])
        expect(after.owners).toEqual(sharedRow ? [peerHash] : [])
        expect(after.markers).toEqual(
          sharedRow ? [`queryCollection:gc:${peerHash}`] : [],
        )
        expect(collection.toArray.map(({ id: rowId }) => rowId)).toEqual(
          sharedRow ? [shared.id] : [],
        )
      })
    },
  )

  /**
   * A historical owner has durable authority until a matching demand applies
   * a replacement. Cleanup can settle this persisted-baseline load while its
   * provider revalidation remains held. An outside observer keeps that call
   * alive. This provider ignores metadata.signal and leaves context.signal
   * unread, so its late cache result must not retire the stored row,
   * historical owner, or retention marker.
   */
  it(`preserves a historical owner when an outside fetch finishes after cleanup`, async () => {
    const id = `historical-outside-cleanup`
    const oldHash = hashKey([id, legacySingletonCategoryDemandKey])
    const request = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const queryKey = [id, getLoadSubsetDemandKey(request)]
    const late: Item = { id: `late`, category: `shared`, name: `Late` }
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([
        [shared.id, { queryCollection: { owners: { [oldHash]: true } } }],
      ]),
      collectionMetadata: new Map([
        [
          `queryCollection:gc:${oldHash}`,
          { queryHash: oldHash, mode: `until-revalidated` },
        ],
      ]),
    })
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [])
    const committed = vi.spyOn(storage.adapter, `applyCommittedTx`)
    const response = createDeferred<Array<Item>>()
    let providerSignal: AbortSignal | undefined
    queryFn.mockImplementation((context: QueryFunctionContext) => {
      providerSignal = context.meta?.loadSubsetOptions?.signal
      return response.promise
    })
    let releaseOutside: (() => void) | undefined
    let stopCache = () => {}
    cleanups.push(() => {
      response.resolve([])
      releaseOutside?.()
      stopCache()
      committed.mockRestore()
      return Promise.resolve()
    })
    await collection.stateWhenReady()
    const load = Promise.resolve(collection._sync.loadSubset(request)).then(
      () => `ready`,
      (error: unknown) => (error as Error).name,
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    const query = queryClient.getQueryCache().find({ queryKey, exact: true })!
    const physicalFetch = query.promise
    const outsideFinished = createDeferred<Array<Item>>()
    const cacheFinished = createDeferred<void>()
    stopCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.query === query &&
        event.type === `updated` &&
        event.action.type === `success` &&
        !event.action.manual
      )
        cacheFinished.resolve()
    })
    const outside = new QueryObserver<Array<Item>>(queryClient, {
      queryKey,
      queryFn,
      staleTime: Number.POSITIVE_INFINITY,
    })
    releaseOutside = outside.subscribe((result) => {
      if (result.isSuccess) outsideFinished.resolve(result.data)
    })
    await collection.cleanup()
    expect(await load).toBe(`ready`)
    const publicAtCleanup = rows(collection)
    const commitsAtCleanup = committed.mock.calls.length
    expect(providerSignal?.aborted).toBe(false)
    response.resolve([late])
    await physicalFetch
    expect(await outsideFinished.promise).toEqual([late])
    await cacheFinished.promise
    // The cache success event follows observer notification. Let its queued
    // application work enter the adapter, then await every started commit.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await Promise.all(
      committed.mock.results.map((result) => Promise.resolve(result.value)),
    )
    expect({
      commitsAfterCleanup: committed.mock.calls.length - commitsAtCleanup,
      providerSignalAborted: providerSignal?.aborted,
      cache: queryClient.getQueryData(queryKey),
      publicRows: rows(collection),
      stored: storedItems(storage),
      owners: persistedOwners(storage.snapshot().rowMetadata, shared.id),
      marker: storage
        .snapshot()
        .collectionMetadata.get(`queryCollection:gc:${oldHash}`),
    }).toEqual({
      commitsAfterCleanup: 0,
      providerSignalAborted: false,
      cache: [late],
      publicRows: publicAtCleanup,
      stored: [shared],
      owners: [oldHash],
      marker: { queryHash: oldHash, mode: `until-revalidated` },
    })
    stopCache()
    stopCache = () => {}
    committed.mockRestore()
    releaseOutside()
    releaseOutside = undefined
  })

  /**
   * An accepted first result waits on a persisted baseline scan while a later
   * refetch publishes its successor. The older caller must reject rather than
   * report the successor as its own applied result. The model keeps separate
   * application identities for the two public calls.
   */
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

  it(`uses the replacement Query when the cache is cleared before an explicit refetch`, async () => {
    const barrier = createDeferred<void>()
    const thirdFetch = createDeferred<Array<Item>>()
    const authoritative = { ...shared, name: `Authoritative` }
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id: `clear-before-explicit-refetch`,
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
      const refresh = collection.utils.refetch({ throwOnError: true })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      await refresh
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.get(shared.id)?.name).toBe(`Authoritative`)
    } finally {
      barrier.resolve()
      collection.deferDataRefresh = null
      thirdFetch.resolve([])
    }
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

// The recorder follows the tested sync run's persisted cache claim across
// rotation. An expired run may own a new retired generation while another run
// still claims the active head, so claiming the logical ID here would inspect
// the wrong cache. The durable comparison reads the physical ID in this run's
// latest claim, without releasing its authority.
function recordRunCacheClaim(
  adapter: PersistenceAdapter,
): () => PersistedCacheGenerationClaim {
  const claimCacheGeneration = adapter.claimCacheGeneration?.bind(adapter)
  const rotateCacheGeneration = adapter.rotateCacheGeneration?.bind(adapter)
  if (!claimCacheGeneration || !rotateCacheGeneration) {
    throw new Error(`Expected managed SQLite cache generations`)
  }
  let current: PersistedCacheGenerationClaim | undefined
  adapter.claimCacheGeneration = async (...args) => {
    current = await claimCacheGeneration(...args)
    return current
  }
  adapter.rotateCacheGeneration = async (...args) => {
    current = await rotateCacheGeneration(...args)
    return current
  }
  return () => {
    if (!current) throw new Error(`Expected a claimed cache generation`)
    return current
  }
}

async function readClaimedCacheRows(
  adapter: PersistenceAdapter,
  claim: PersistedCacheGenerationClaim,
): Promise<Array<{ key: string | number; name: unknown }>> {
  const persistedRows = await adapter.loadSubset(
    {
      kind: `managed`,
      storageCollectionId: claim.storageCollectionId,
      claimId: claim.claimId,
    },
    {},
    {
      cacheGenerationClaimId: claim.claimId,
    },
  )
  return persistedRows
    .map((row) => ({ key: row.key, name: row.value.name }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

// Law: when a persisted cache claim expires, an on-demand Query Collection
// reacquires only active demands from a fetch that starts after rotation.
// Model: the provider's current rows replace the expired cache's rows for the
// active subset. The QueryClient may still contain the old success, but that
// success has no authority over the new persisted cache generation. This real
// SQLite/QueryClient driver checks public and durable rows when reacquisition
// settles.
it(`reacquires an active Query subset after its SQLite cache claim expires`, async () => {
  const id = `query-cache-claim-recovery`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const currentClaim = recordRunCacheClaim(managed.adapter)
  const queryClient = createQueryClient()
  let activeRows: Array<Item> = [
    { id: `active-old`, category: `active`, name: `Old` },
  ]
  const triggeringRows: Array<Item> = [
    { id: `trigger-fresh`, category: `active`, name: `Trigger` },
  ]
  const activeDemandKey = getLoadSubsetDemandKey({ limit: 1 })
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      structuredClone(
        context.queryKey[1] === activeDemandKey ? activeRows : triggeringRows,
      ),
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
        startSync: true,
      }),
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`active-old`])
  expect(queryFn).toHaveBeenCalledTimes(1)
  const oldStorageId = currentClaim().storageCollectionId

  now += 10_001
  activeRows = [{ id: `active-fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  await vi.waitFor(() =>
    expect(new Set(itemIds(collection.toArray))).toEqual(
      new Set([`active-fresh`, `trigger-fresh`]),
    ),
  )
  expect(
    queryFn.mock.calls.filter(
      ([context]) => context.queryKey[1] === activeDemandKey,
    ),
  ).toHaveLength(2)
  expect(currentClaim().storageCollectionId).not.toBe(oldStorageId)
  expect(await readClaimedCacheRows(managed.adapter, currentClaim())).toEqual([
    { key: `active-fresh`, name: `Fresh` },
    { key: `trigger-fresh`, name: `Trigger` },
  ])
})

// Distinct Query keys are independent documents even when one key is a
// prefix of the other and both Collections share one QueryClient. The model
// has two claims: A expires at 11000 and B, acquired later, expires at 15000.
// At 11001 only A may replace its persisted cache generation and source row.
// The real QueryClient uses prefix matching, so B's cache entry is deliberately
// inside A's base-key search. Public rows, B's Query entry, its durable rows,
// its current storage ID, and its fetch count are compared after A reloads.
it(`keeps a warm Query Collection independent when a prefix-sharing peer rotates`, async () => {
  const firstId = `query-prefix-rotation-a`
  const secondId = `query-prefix-rotation-b`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const firstManaged = persistence.resolvePersistenceForCollection!({
    collectionId: firstId,
    mode: `sync-present`,
  })
  const secondManaged = persistence.resolvePersistenceForCollection!({
    collectionId: secondId,
    mode: `sync-present`,
  })
  const queryClient = createQueryClient()
  const firstDemand = { limit: 1 }
  const secondDemand = { limit: 2 }
  const firstKey = [`shared-prefix`, getLoadSubsetDemandKey(firstDemand)]
  const secondKey = [
    `shared-prefix`,
    `peer`,
    getLoadSubsetDemandKey(firstDemand),
  ]
  let firstRows: Array<Item> = [
    { id: `first-old`, category: `active`, name: `Old` },
  ]
  const firstQueryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      structuredClone(
        context.queryKey[1] === getLoadSubsetDemandKey(firstDemand)
          ? firstRows
          : [{ id: `trigger`, category: `active`, name: `Trigger` }],
      ),
    ),
  )
  const secondRow: Item = {
    id: `second-warm`,
    category: `peer`,
    name: `Warm`,
  }
  const secondQueryFn = vi.fn(() => Promise.resolve([secondRow]))
  const first = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id: firstId,
        queryClient,
        queryKey: [`shared-prefix`],
        queryFn: firstQueryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence: firstManaged,
    }),
  )
  const mounted = [first]
  cleanups.push(async () => {
    for (const collection of mounted.reverse()) await collection.cleanup()
    queryClient.clear()
    driver.close()
  })
  await first._sync.loadSubset(firstDemand)
  expect(itemIds(first.toArray)).toEqual([`first-old`])
  expect(queryClient.getQueryData(firstKey)).toHaveLength(1)

  now = 5_000
  const peer = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id: secondId,
        queryClient,
        queryKey: [`shared-prefix`, `peer`],
        queryFn: secondQueryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence: secondManaged,
    }),
  )
  mounted.push(peer)
  await peer._sync.loadSubset(firstDemand)
  expect(itemIds(peer.toArray)).toEqual([`second-warm`])
  expect(secondQueryFn).toHaveBeenCalledTimes(1)
  const secondHead = driver
    .getDatabase()
    .prepare(
      `SELECT physical_id FROM cache_generation
       WHERE logical_id = ? AND retired = 0`,
    )
    .get(secondId) as { physical_id: string }
  const secondClaim = driver
    .getDatabase()
    .prepare(`SELECT claim_id FROM cache_generation_claim WHERE logical_id = ?`)
    .get(secondId) as { claim_id: string }
  expect(
    await secondManaged.adapter.loadSubset(
      {
        kind: `managed`,
        storageCollectionId: secondHead.physical_id,
        claimId: secondClaim.claim_id,
      },
      {},
      {
        cacheGenerationClaimId: secondClaim.claim_id,
      },
    ),
  ).toMatchObject([{ value: secondRow }])

  now = 11_001
  firstRows = [{ id: `first-fresh`, category: `active`, name: `Fresh` }]
  await first._sync.loadSubset(secondDemand)
  await vi.waitFor(() =>
    expect(new Set(itemIds(first.toArray))).toEqual(
      new Set([`first-fresh`, `trigger`]),
    ),
  )
  expect(itemIds(peer.toArray)).toEqual([`second-warm`])
  expect(queryClient.getQueryData(secondKey)).toEqual([secondRow])
  expect(secondQueryFn).toHaveBeenCalledTimes(1)
  expect(
    driver
      .getDatabase()
      .prepare(
        `SELECT physical_id FROM cache_generation
         WHERE logical_id = ? AND retired = 0`,
      )
      .get(secondId),
  ).toMatchObject(secondHead)
  expect(
    await secondManaged.adapter.loadSubset(
      {
        kind: `managed`,
        storageCollectionId: secondHead.physical_id,
        claimId: secondClaim.claim_id,
      },
      {},
      {
        cacheGenerationClaimId: secondClaim.claim_id,
      },
    ),
  ).toMatchObject([{ value: secondRow }])
})

// A claim can expire while persisted startup is reading metadata, before the
// Query source enters its sync run. The wrapper rotates the cache privately at
// that boundary. The old QueryClient success is not a source snapshot for the
// replacement generation: the first demand must fetch and publish fresh rows.
// With no rotation, an existing QueryClient success remains reusable. This
// real SQLite driver checks both sides of that boundary at demand settlement.
it.each([false, true])(
  `uses cached QueryClient data according to private startup rotation: %s`,
  async (rotateAtStartup) => {
    const id = `query-cache-startup-rotation`
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    let now = 1_000
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const claim = managed.adapter.claimCacheGeneration!.bind(managed.adapter)
    const rotate = managed.adapter.rotateCacheGeneration!.bind(managed.adapter)
    let rotations = 0
    if (rotateAtStartup) {
      managed.adapter.claimCacheGeneration = async (...args) => {
        const acquired = await claim(...args)
        now = 12_000
        return acquired
      }
    }
    managed.adapter.rotateCacheGeneration = async (...args) => {
      rotations++
      return rotate(...args)
    }
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      [id, getLoadSubsetDemandKey({ limit: 1 })],
      [{ id: `old`, category: `active`, name: `Old` }],
    )
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `fresh`, category: `active`, name: `Fresh` }]),
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
          startSync: true,
        }),
        persistence: managed,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
      driver.close()
    })

    await collection.stateWhenReady()
    await collection._sync.loadSubset({ limit: 1 })
    expect(rotations).toBe(rotateAtStartup ? 1 : 0)
    expect(queryFn).toHaveBeenCalledTimes(rotateAtStartup ? 1 : 0)
    expect(itemIds(collection.toArray)).toEqual([
      rotateAtStartup ? `fresh` : `old`,
    ])
  },
)

// Two rotations may be queued before the first reaches its source restart.
// The latest rotation alone owns reacquisition. At the held second-rotation
// checkpoint the model still has no authoritative source row, so neither the
// old Query observer nor the first recovery may start another provider fetch.
// After the final rotation, the active demand must fetch and apply a new row.
it(`waits for the final SQLite rotation before reacquiring a Query subset`, async () => {
  const id = `query-cache-overlapping-rotations`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => 1_000,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const rotate = managed.adapter.rotateCacheGeneration?.bind(managed.adapter)
  if (!rotate) throw new Error(`Expected managed SQLite rotation`)
  const secondRotationEntered = createDeferred<void>()
  const releaseSecondRotation = createDeferred<void>()
  let rotations = 0
  managed.adapter.rotateCacheGeneration = async (...args) => {
    if (++rotations === 2) {
      secondRotationEntered.resolve()
      await releaseSecondRotation.promise
    }
    return rotate(...args)
  }
  const queryClient = createQueryClient()
  let fetches = 0
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn: () =>
      Promise.resolve([
        { id: `r${++fetches}`, category: `active`, name: `source` },
      ]),
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    startSync: true,
  })
  const sourceSync = queryOptions.sync.sync
  let recover!: () => Promise<void>
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      sync: {
        ...queryOptions.sync,
        sync: (params) => {
          recover = params.metadata!.persistence!.startScopedRecovery!
          return sourceSync(params)
        },
      },
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    releaseSecondRotation.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  const demand = { limit: 1 }
  await collection._sync.loadSubset(demand)
  expect(itemIds(collection.toArray)).toEqual([`r1`])
  const first = recover()
  const second = recover()
  await secondRotationEntered.promise
  await first
  expect(rotations).toBe(2)
  expect(fetches, `before the final cache rotation`).toBe(1)
  expect(itemIds(collection.toArray)).toEqual([])

  releaseSecondRotation.resolve()
  await second
  await vi.waitFor(() => expect(collection.size).toBe(1))
  expect(collection.has(`r1`)).toBe(false)
  expect(fetches).toBeGreaterThan(1)
})

// The old Query fetch can outlive a cache rotation even when its observer is
// released. A late success has no authority to republish a row into the new
// generation. The provider snapshot is captured before the held fetch, so the
// old and fresh rows are distinguishable in both public and durable state at
// the settlement and stale-fetch-release checkpoints.
it(`does not publish a Query result started before SQLite cache rotation`, async () => {
  const id = `query-cache-claim-late-fetch`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const currentClaim = recordRunCacheClaim(managed.adapter)
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  let holdNextFetch = false
  const oldFetchEntered = createDeferred<void>()
  const releaseOldFetch = createDeferred<void>()
  const queryFn = vi.fn(async () => {
    const snapshot = structuredClone(providerRows)
    if (holdNextFetch) {
      holdNextFetch = false
      oldFetchEntered.resolve()
      await releaseOldFetch.promise
    }
    return snapshot
  })
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
        startSync: true,
      }),
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    releaseOldFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`old`])
  const oldStorageId = currentClaim().storageCollectionId
  holdNextFetch = true
  const oldLoad = Promise.resolve(
    collection._sync.loadSubset({ limit: 1, refetch: true }),
  )
  void oldLoad.catch(() => undefined)
  await oldFetchEntered.promise

  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
  expect(currentClaim().storageCollectionId).not.toBe(oldStorageId)
  expect(await readClaimedCacheRows(managed.adapter, currentClaim())).toEqual([
    { key: `fresh`, name: `Fresh` },
  ])

  releaseOldFetch.resolve()
  await Promise.allSettled([oldLoad])
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
  expect(await readClaimedCacheRows(managed.adapter, currentClaim())).toEqual([
    { key: `fresh`, name: `Fresh` },
  ])
})

// A peer Query observer may already have a fetch in flight when persistence
// rotates its startup cache. With no cached Query result, the first Collection
// demand joins that old fetch. Neither its success nor its error establishes
// the replacement generation. The demand must start another fetch and apply
// the fresh source row. The provider outcome is an independent history axis.
it.each([`success`, `error`] as const)(
  `reacquires after a pre-start Query fetch ends with %s`,
  async (oldOutcome) => {
    const id = `query-cache-pre-start-fetch-${oldOutcome}`
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    let now = 1_000
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const claim = managed.adapter.claimCacheGeneration!.bind(managed.adapter)
    managed.adapter.claimCacheGeneration = async (...args) => {
      const acquired = await claim(...args)
      now = 12_000
      return acquired
    }
    const queryClient = createQueryClient()
    const activeDemandKey = getLoadSubsetDemandKey({ limit: 1 })
    const oldFetchEntered = createDeferred<void>()
    const releaseOldFetch = createDeferred<void>()
    const peer = new QueryObserver(queryClient, {
      queryKey: [id, activeDemandKey],
      queryFn: async () => {
        oldFetchEntered.resolve()
        await releaseOldFetch.promise
        if (oldOutcome === `error`) throw new Error(`retired fetch failed`)
        return [{ id: `old`, category: `active`, name: `Old` }]
      },
      retry: false,
    })
    const releasePeer = peer.subscribe(() => {})
    await oldFetchEntered.promise
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `fresh`, category: `active`, name: `Fresh` }]),
    )
    const sourceLoadEntered = createDeferred<void>()
    const queryOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      retry: false,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...queryOptions,
        sync: {
          ...queryOptions.sync,
          sync: (params) => {
            const source = queryOptions.sync.sync(params)
            if (!source || typeof source === `function` || !source.loadSubset) {
              throw new Error(`Expected on-demand Query source`)
            }
            return {
              ...source,
              loadSubset: (options) => {
                const work = source.loadSubset!(options)
                sourceLoadEntered.resolve()
                return work
              },
            }
          },
        },
        persistence: managed,
      }),
    )
    cleanups.push(async () => {
      releaseOldFetch.resolve()
      releasePeer()
      await collection.cleanup()
      queryClient.clear()
      driver.close()
    })

    await collection.stateWhenReady()
    const load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
    void load.catch(() => undefined)
    await sourceLoadEntered.promise
    expect(queryFn).not.toHaveBeenCalled()
    expect(collection.size).toBe(0)
    releaseOldFetch.resolve()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        load,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`fresh Query demand remained pending`)),
            500,
          )
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(itemIds(collection.toArray)).toEqual([`fresh`])
  },
)

// A later demand is a separate ownership node. A previous QueryClient success
// for that key remains an ordinary cache hit, but it cannot establish rows in
// the replacement SQLite generation. The held provider fetch gives this
// history a checkpoint before fresh rows are available: the old cached row
// must stay absent, and the demand may settle only after fresh application.
it(`refetches a later Query demand with old client data after cache rotation`, async () => {
  const id = `query-cache-claim-later-demand`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  const laterProviderRows: Array<Item> = [
    { id: `later`, category: `active`, name: `Later` },
  ]
  let holdFetch = false
  const freshFetchEntered = createDeferred<void>()
  const releaseFreshFetch = createDeferred<void>()
  const queryFn = vi.fn(async (context: QueryFunctionContext) => {
    if (holdFetch) {
      freshFetchEntered.resolve()
      await releaseFreshFetch.promise
    }
    return structuredClone(
      context.queryKey[1] === getLoadSubsetDemandKey({ limit: 2 })
        ? laterProviderRows
        : providerRows,
    )
  })
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
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    releaseFreshFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`old`])
  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 1, refetch: true })
  expect(itemIds(collection.toArray)).toEqual([`fresh`])

  const laterDemand = { limit: 2 }
  queryClient.setQueryData(
    [id, getLoadSubsetDemandKey(laterDemand)],
    [{ id: `stale`, category: `active`, name: `Stale` }],
  )
  holdFetch = true
  const load = Promise.resolve(collection._sync.loadSubset(laterDemand))
  void load.catch(() => undefined)
  await freshFetchEntered.promise
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
  releaseFreshFetch.resolve()
  await load
  expect(itemIds(collection.toArray)).toEqual([`fresh`, `later`])
})

// A new key has no fetch from the retired cache generation. The generation
// boundary requires a fresh provider result, but its first fetch already
// supplies that result. The request log is the observation: a cancelled first
// fetch followed by a second one would return the right rows while wasting
// one transport for every new key after recovery.
it(`fetches a new Query key once after cache rotation`, async () => {
  const id = `query-cache-new-key-after-rotation`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve([
      {
        id: `row-${String(context.queryKey[1])}`,
        category: `active`,
        name: `source`,
      },
    ]),
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
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  now += 10_001
  await collection._sync.loadSubset({ limit: 1, refetch: true })
  const beforeNewKey = queryFn.mock.calls.length
  await collection._sync.loadSubset({ limit: 2 })
  expect(queryFn.mock.calls.length - beforeNewKey).toBe(1)

  const laterDemand = { limit: 3 }
  queryClient.setQueryData(
    [id, getLoadSubsetDemandKey(laterDemand)],
    [{ id: `stale`, category: `active`, name: `Stale` }],
  )
  const beforeSeededKey = queryFn.mock.calls.length
  await collection._sync.loadSubset(laterDemand)
  expect(queryFn.mock.calls.length - beforeSeededKey).toBe(1)
})

// Rotation is a durable authority boundary. If SQLite refuses it, the current
// sync run cannot resume its old observers as if the cache were still valid.
// The public Collection status and later demand rejection make this fail-stop
// visible; a pending internal recovery flag alone is not a silent freeze.
it(`reports a failed Query cache rotation as a terminal Collection error`, async () => {
  const id = `query-cache-failed-rotation`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    now: () => 1_000,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const failure = new Error(`rotation refused`)
  const rotationEntered = createDeferred<void>()
  managed.adapter.rotateCacheGeneration = async () => {
    rotationEntered.resolve()
    throw failure
  }
  const queryClient = createQueryClient()
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn: () =>
      Promise.resolve([{ id: `old`, category: `active`, name: `Old` }]),
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    startSync: true,
  })
  const sourceSync = queryOptions.sync.sync
  let recover!: () => Promise<void>
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      sync: {
        ...queryOptions.sync,
        sync: (params) => {
          recover = params.metadata!.persistence!.startScopedRecovery!
          return sourceSync(params)
        },
      },
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  const outcome = recover()
  await rotationEntered.promise
  await expect(outcome).rejects.toBe(failure)
  expect(collection.status).toBe(`error`)
  await expect(collection._sync.loadSubset({ limit: 2 })).rejects.toBe(failure)
})

// A public refetch returns a Query result only if that result still belongs to
// the current persisted cache generation. This provider captures the old row
// before a held fetch, then recovery rotates SQLite and applies the fresh row.
// The old result may complete in QueryClient, but the utility must report its
// invalidated operation as canceled instead of fulfilling with unapplied data.
it(`cancels a Query utility refetch whose result crosses cache rotation`, async () => {
  const id = `query-cache-claim-held-utility-refetch`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  const oldFetchEntered = createDeferred<void>()
  const releaseOldFetch = createDeferred<void>()
  let fetches = 0
  const queryFn = vi.fn(async () => {
    const snapshot = structuredClone(providerRows)
    if (++fetches === 2) {
      oldFetchEntered.resolve()
      await releaseOldFetch.promise
    }
    return snapshot
  })
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
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    releaseOldFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`old`])
  const oldRefetch = collection.utils.refetch({ throwOnError: true })
  void oldRefetch.catch(() => undefined)
  await oldFetchEntered.promise
  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  expect(itemIds(collection.toArray)).toEqual([`fresh`])

  releaseOldFetch.resolve()
  await expect(oldRefetch).rejects.toBeInstanceOf(CancelledError)
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
})

// A released acquisition cannot schedule another provider fetch. In this
// history a refetch has joined an old, held Query fetch; cache rotation
// invalidates that result, and unload retires its final observer lease. When
// the old fetch completes, the call count must stay fixed at the release cut.
it(`does not restart a released Query acquisition after cache rotation`, async () => {
  const id = `query-cache-claim-released-refetch`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  const oldFetchEntered = createDeferred<void>()
  const releaseOldFetch = createDeferred<void>()
  const activeDemandKey = getLoadSubsetDemandKey({ limit: 1 })
  let activeFetches = 0
  const queryFn = vi.fn(async (context: QueryFunctionContext) => {
    const snapshot = structuredClone(providerRows)
    if (context.queryKey[1] === activeDemandKey && ++activeFetches === 2) {
      oldFetchEntered.resolve()
      await releaseOldFetch.promise
    }
    return snapshot
  })
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
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    releaseOldFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  const initialRequest: LoadSubsetOptions = { limit: 1 }
  const refetchRequest: LoadSubsetOptions = { limit: 1, refetch: true }
  await collection._sync.loadSubset(initialRequest)
  const oldLoad = Promise.resolve(collection._sync.loadSubset(refetchRequest))
  void oldLoad.catch(() => undefined)
  await oldFetchEntered.promise
  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  collection._sync.unloadSubset(initialRequest)
  collection._sync.unloadSubset(refetchRequest)
  const fetchesAtRelease = activeFetches
  releaseOldFetch.resolve()
  await Promise.allSettled([oldLoad])
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(activeFetches).toBe(fetchesAtRelease)
  expect(collection.get(`old`)).toBeUndefined()
})

// Retention maintenance reads old persisted ownership before deciding what to
// delete. A scan returned by the old SQLite generation has no authority after
// rotation, even if a fresh provider result uses the same row key. The wrapper
// holds the completed real-adapter scan so the check observes the fresh row
// both before and after the stale maintenance continuation is released.
it(`does not delete a fresh Query row from an old retention scan`, async () => {
  // The old retention scan must start after the Collection is ready, however
  // long startup takes. Startup cleans up an entry that has already expired,
  // and that would hold the scan inside startup. So the entry expires a minute
  // out on a fake clock that advances with real time, and the test moves the
  // clock past it only after readiness.
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `Date`],
    shouldAdvanceTime: true,
  })
  const id = `query-cache-claim-held-retention`
  const oldRow: Item = { id: `same`, category: `active`, name: `Old` }
  const freshRow: Item = { ...oldRow, name: `Fresh` }
  const subset = { limit: 1 }
  const queryHash = hashKey([id, getLoadSubsetDemandKey(subset)])
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  const scanEntered = createDeferred<void>()
  const releaseOldScan = createDeferred<void>()
  let scans = 0
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn: () => Promise.resolve([freshRow]),
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    startSync: true,
  })
  const originalSync = queryOptions.sync.sync
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      sync: {
        ...queryOptions.sync,
        sync: (params) => {
          const metadata = params.metadata!
          const capability = metadata.persistence!
          const scan = capability.scanPersistedRows
          params.begin()
          params.write({ type: `insert`, value: oldRow })
          metadata.row.set(oldRow.id, {
            queryCollection: { owners: { [queryHash]: true } },
          })
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `ttl`,
            expiresAt: Date.now() + 60_000,
          })
          params.commit()
          return originalSync({
            ...params,
            metadata: {
              ...metadata,
              persistence: {
                ...capability,
                scanPersistedRows: async (...args) => {
                  const snapshot = await scan(...args)
                  if (++scans === 1) {
                    scanEntered.resolve()
                    await releaseOldScan.promise
                  }
                  return snapshot
                },
              },
            },
          })
        },
      },
      persistence,
    }),
  )
  cleanups.push(async () => {
    vi.useRealTimers()
    releaseOldScan.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection.stateWhenReady()
  expect(scans).toBe(0)
  await vi.advanceTimersByTimeAsync(60_001)
  await scanEntered.promise
  now += 10_001
  await collection._sync.loadSubset(subset)
  expect(collection.get(`same`)?.name).toBe(`Fresh`)
  releaseOldScan.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(collection.get(`same`)?.name).toBe(`Fresh`)
  expect(collection.status).toBe(`ready`)
})
