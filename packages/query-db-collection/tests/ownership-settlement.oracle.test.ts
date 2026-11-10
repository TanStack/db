/**
 * # When does a public refetch settle?
 *
 * A successful admitted result has an explicit applied, rejected or cancelled
 * terminal outcome. Deferring a result is not terminal: its caller waits for
 * the replacement. Outside an active mutation phase, successful public refetch
 * waits for its exact accepted application obligations, including a nested
 * reentrant receipt. Handler-phase refetch uses the fetch boundary so the
 * handler can settle, and later application failure is recorded separately.
 * Authority: Query guide, Controlling Refetch Behavior, and the ownership
 * oracle's original result-settlement and call-obligation contracts.
 *
 * The existing reducers compute expectations independently of the drivers.
 * These finite histories retain the original empty, invalid, recovered,
 * deferred, cleanup, overlapping-barrier and reentry cuts. Drivers record
 * promise outcomes, public rows, publications, exact error identities and work
 * through real QueryClient and Collection paths. Persistence is controlled;
 * this file makes no native-host or arbitrary retry claim.
 */
import { hashKey, isCancelledError } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { afterEach, vi } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'

import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import { InvalidQueryResultError } from '../src/errors.js'
import {
  advanceResultSettlementModel,
  createRefetchCallSettlementModel,
  observeExplicitRefetchApplication,
  observeHandlerRefetchBoundary,
  observeRefetchCallSettlement,
  reduceExplicitRefetchApplication,
  reduceHandlerRefetchBoundary,
  reduceRefetchCallSettlement,
  startResultSettlementModel,
} from './ownership-model-oracle'
import {
  cleanups,
  createOwnershipFixture,
  createQueryClient,
  reportedError,
  rows,
  runCleanups,
  shared,
} from './ownership-lifecycle-support.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type {
  ExplicitRefetchApplicationModel,
  HandlerRefetchBoundaryModel,
  PublicRefetchObservation,
  RefetchApplicationOutcome,
  ResultSettlementModelAction,
  ResultSettlementModelState,
} from './ownership-model-oracle'
import type { Item } from './ownership-lifecycle-support.js'

function diagnosticField(
  error: unknown,
  field: 'name' | 'message',
): string | undefined {
  if (typeof error !== 'object' || error === null || !(field in error))
    return undefined
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}
afterEach(runCleanups)
type RecordFact = (checkpoint: string, value: unknown) => void

/** Wait for a production boundary without computing an expected row. If the
 * boundary does not arrive, record the last fact and return; the property's
 * check identifies that cut rather than losing the mismatch to a setup error. */
async function boundary(test: () => boolean): Promise<boolean> {
  for (let turn = 0; turn < 200; turn++) {
    if (test()) return true
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  return test()
}

/** Domain checks retain every observation cut in the old driver. No expected
 * value is recorded by a production callback: models build the owed facts
 * from authored history data, and this check compares the ordered trace. */
function checkCuts(
  actual: ReadonlyArray<Observation>,
  expected: ReadonlyArray<Observation>,
  law: string,
): Verdict {
  for (let i = 0; i < expected.length; i++) {
    const wanted = expected[i]!
    const got = actual[i]
    if (!got)
      return violation(
        wanted.checkpoint,
        'the promised observation cut was not reached',
        law,
      )
    const difference = differs(wanted.checkpoint, law, got, wanted)
    if (difference) return difference
  }
  return differs('trace-length', law, actual.length, expected.length) ?? pass
}

async function observeBoundary<T>(
  observe: RecordFact,
  checkpoint: string,
  read: () => T,
  ready: (value: T) => boolean,
): Promise<boolean> {
  const reached = await boundary(() => ready(read()))
  observe(checkpoint, read())
  return reached
}
async function settle<T>(
  promise: PromiseLike<T>,
): Promise<
  { outcome: 'resolved'; value: T } | { outcome: 'rejected'; error: unknown }
> {
  try {
    return { outcome: 'resolved', value: await promise }
  } catch (error) {
    return { outcome: 'rejected', error }
  }
}
/** The same result-settlement reducer judges every original public outcome.
 * This projection is the old checker's promised answer, without a Vitest
 * assertion. Call, publication, diagnostics, and work remain separate facts. */
function owedPublic(
  state: ResultSettlementModelState,
  id: string,
): PublicRefetchObservation {
  const operation = state.get(id)
  if (!operation) throw Error('Unknown authored public refetch')
  if (operation.phase !== 'terminal') return { settled: false }
  return operation.outcome === 'applied'
    ? {
        settled: true,
        outcome: 'fulfilled',
        ...(operation.rowCount === undefined
          ? {}
          : { rowCount: operation.rowCount }),
      }
    : { settled: true, outcome: 'rejected' }
}
function resultAfter(
  operation: string,
  result: 'applicable' | 'invalid-shape',
  rowCount?: 0 | 1,
  deferOn?: string,
): ResultSettlementModelState {
  return advanceResultSettlementModel(startResultSettlementModel(operation), {
    type: 'query-succeeded',
    operation,
    result,
    ...(rowCount === undefined ? {} : { rowCount }),
    ...(deferOn ? { deferOn } : {}),
  })
}
function resultFact(
  state: ResultSettlementModelState,
  id: string,
): Observation {
  return { checkpoint: 'public:' + id, value: owedPublic(state, id) }
}
const fact = (checkpoint: string, value: unknown): Observation => ({
  checkpoint,
  value,
})
function emptySettlementModel(): Array<Observation> {
  return [
    resultFact(resultAfter('empty-result', 'applicable', 0), 'empty-result'),
  ]
}
function deferredSettlementModel(): Array<Observation> {
  let model = resultAfter('deferred-result', 'applicable', 1, 'barrier-a')
  const expected = [
    fact('fetch-calls:2', 2),
    resultFact(model, 'deferred-result'),
    fact('held-name', 'Initial'),
    fact('fetch-calls:3', 3),
  ]
  model = advanceResultSettlementModel(model, {
    type: 'refresh-succeeded',
    barrier: 'barrier-a',
    result: 'applicable',
    rowCount: 1,
  })
  return [
    ...expected,
    resultFact(model, 'deferred-result'),
    fact('replacement-name', 'Replacement'),
  ]
}
function cleanupSettlementModel(): Array<Observation> {
  const model = advanceResultSettlementModel(
    resultAfter('deferred-cleanup', 'applicable', 1, 'barrier-a'),
    { type: 'retire' },
  )
  return [
    fact('fetch-calls:2', 2),
    resultFact(model, 'deferred-cleanup'),
    fact('cancelled-error', true),
  ]
}
function recoveredSettlementModel(): Array<Observation> {
  let model = resultAfter('invalid', 'invalid-shape')
  model = advanceResultSettlementModel(model, {
    type: 'start-refetch',
    operation: 'recovered',
  })
  model = advanceResultSettlementModel(model, {
    type: 'query-succeeded',
    operation: 'recovered',
    result: 'applicable',
  })
  return [
    fact('initial-load-error', true),
    fact('recovery-work', { queryCalls: 2, scanCalls: 1 }),
    resultFact(model, 'recovered'),
    fact('recovered-name', 'Recovered'),
  ]
}
function eagerRecoveredSettlementModel(): Array<Observation> {
  let model = resultAfter('invalid', 'invalid-shape')
  model = advanceResultSettlementModel(model, {
    type: 'start-refetch',
    operation: 'recovered',
  })
  model = advanceResultSettlementModel(model, {
    type: 'query-succeeded',
    operation: 'recovered',
    result: 'applicable',
    rowCount: 1,
  })
  return [
    fact('initial-load-error', true),
    fact('initial-error-status', { status: 'error', errorDefined: true }),
    fact('fetch-calls:2', 2),
    resultFact(model, 'recovered'),
    fact('recovery-error', undefined),
    fact('recovered-state', {
      status: 'error',
      errorDefined: true,
      name: 'Recovered',
    }),
  ]
}
function retainedInvalidSettlementModel(): Array<Observation> {
  return [
    fact('initial-work', { queryCalls: 1, scanCalls: 1 }),
    fact('fetch-calls:2', 2),
    resultFact(
      resultAfter('retained-invalid-result', 'invalid-shape'),
      'retained-invalid-result',
    ),
    fact('invalid-error', true),
  ]
}
function overlappingDeferralModel(): Array<Observation> {
  let model = new Map() as ResultSettlementModelState
  const step = (action: ResultSettlementModelAction) => {
    model = advanceResultSettlementModel(model, action)
  }
  step({ type: 'start-refetch', operation: 'first' })
  step({
    type: 'query-succeeded',
    operation: 'first',
    result: 'applicable',
    rowCount: 1,
    deferOn: 'barrier-a',
  })
  const expected = [
    fact('first-skipped', {
      queryCalls: 2,
      data: [{ ...shared, name: 'Skipped A' }],
    }),
  ]
  step({ type: 'start-refetch', operation: 'second' })
  step({
    type: 'query-succeeded',
    operation: 'second',
    result: 'applicable',
    rowCount: 1,
    deferOn: 'barrier-b',
  })
  expected.push(
    fact('second-skipped', {
      queryCalls: 3,
      data: [{ ...shared, name: 'Skipped B' }],
    }),
    fact('fetch-calls:4', 4),
  )
  step({
    type: 'refresh-succeeded',
    barrier: 'barrier-a',
    result: 'applicable',
    rowCount: 1,
    deferOn: 'barrier-b',
  })
  expected.push(
    resultFact(model, 'first'),
    resultFact(model, 'second'),
    fact('held-name', 'Initial'),
    fact('fetch-calls:5', 5),
  )
  step({
    type: 'refresh-succeeded',
    barrier: 'barrier-b',
    result: 'applicable',
    rowCount: 1,
  })
  return [
    ...expected,
    resultFact(model, 'first'),
    resultFact(model, 'second'),
    fact('replacement-name', 'Replacement'),
  ]
}
function independentSettlementModel(): Array<Observation> {
  let model = resultAfter('old', 'applicable', 1, 'barrier-a')
  model = advanceResultSettlementModel(model, {
    type: 'start-refetch',
    operation: 'fresh',
  })
  model = advanceResultSettlementModel(model, {
    type: 'query-succeeded',
    operation: 'fresh',
    result: 'applicable',
    rowCount: 1,
  })
  return [
    fact('old-skipped', {
      queryCalls: 2,
      data: [{ ...shared, name: 'Skipped' }],
    }),
    fact('fresh-applied', { queryCalls: 3, name: 'Fresh' }),
    resultFact(model, 'old'),
    resultFact(model, 'fresh'),
  ]
}
function applicationFailureModel(h: {
  throwOnError: boolean
}): Array<Observation> {
  let model: ExplicitRefetchApplicationModel = {
    calls: new Map(),
    publicValues: new Map([['query', 'Initial']]),
  }
  model = reduceExplicitRefetchApplication(model, {
    type: 'start-call',
    callId: 1,
    resultIds: ['query'],
    throwOnError: h.throwOnError,
  })
  model = reduceExplicitRefetchApplication(model, {
    type: 'accept-result',
    callId: 1,
    resultId: 'query',
    value: 'Invalid',
  })
  model = reduceExplicitRefetchApplication(model, {
    type: 'reject-application',
    callId: 1,
    resultId: 'query',
  })
  const outcome = observeExplicitRefetchApplication(model, 1)
  return [
    fact(
      'refetch-return',
      h.throwOnError
        ? { outcome: 'rejected', expectedError: true }
        : { outcome: 'resolved', length: 1 },
    ),
    fact('application-outcome', outcome.refetch),
    fact('explicit-refetch', outcome),
  ]
}
function handlerFailureModel(): Array<Observation> {
  let model: HandlerRefetchBoundaryModel = {
    fetch: 'pending',
    application: 'unaccepted',
    throwOnError: true,
  }
  model = reduceHandlerRefetchBoundary(model, { type: 'accept-application' })
  model = reduceHandlerRefetchBoundary(model, {
    type: 'settle-fetch',
    outcome: 'fulfilled',
  })
  model = reduceHandlerRefetchBoundary(model, {
    type: 'settle-application',
    outcome: 'rejected',
  })
  return [
    fact('application-error-recorded', true),
    fact('handler-boundary', observeHandlerRefetchBoundary(model)),
  ]
}
function reentrantSettlementModel(
  receiptOutcome: 'fulfilled' | 'rejected',
): Array<Observation> {
  let model = createRefetchCallSettlementModel(['query'], true)
  model = reduceRefetchCallSettlement(model, {
    type: 'accept-application',
    queryId: 'query',
    applicationId: 'reentrant-application',
  })
  model = reduceRefetchCallSettlement(model, {
    type: 'settle-fetch',
    queryId: 'query',
    outcome: 'fulfilled',
  })
  const publication = [
    [{ type: 'update', name: 'Updated', previousName: 'Initial' }],
  ]
  const expected = [
    fact('reentered', true),
    fact('nested-commits', 1),
    fact('fetch-calls:2', 2),
    fact('refetch-pending', observeRefetchCallSettlement(model).refetch),
    fact('held-publications', publication),
    fact(
      'refetch-return',
      receiptOutcome === 'fulfilled'
        ? { outcome: 'resolved', length: 1 }
        : { outcome: 'rejected', expectedError: true },
    ),
  ]
  model = reduceRefetchCallSettlement(model, {
    type: 'settle-application',
    applicationId: 'reentrant-application',
    outcome: receiptOutcome,
  })
  return [
    ...expected,
    fact('refetch-terminal', observeRefetchCallSettlement(model).refetch),
    fact('applied-name', 'Updated'),
    fact('terminal-publications', publication),
  ]
}

function invalidResultModel(h: { diagnostic: string }) {
  return {
    settlement: owedPublic(
      resultAfter('invalid-result', 'invalid-shape'),
      'invalid-result',
    ),
    diagnostic: h.diagnostic,
  }
}
function invalidResultCheck(
  _h: unknown,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof invalidResultModel>,
): Verdict {
  const outcome = trace[0]
  const failed = differs(
    'public:invalid-result',
    'public result settlement',
    outcome,
    { checkpoint: 'public:invalid-result', value: expected.settlement },
  )
  if (failed) return failed
  const diagnostics = trace[1]
  if (diagnostics?.checkpoint !== 'invalid-diagnostics')
    return violation(
      'invalid-diagnostics',
      'invalid-result diagnostics were not observed',
      'public result settlement',
    )
  const observed = diagnostics.value as {
    invalidClass: boolean
    rejectionMessage?: string
    rows: Array<string>
    consoleCalls: Array<{
      context: unknown
      errorName?: string
      errorMessage?: string
    }>
  }
  const call = observed.consoleCalls[0]
  return (
    differs(
      'invalid-diagnostics',
      'public result settlement',
      {
        invalidClass: observed.invalidClass,
        messageHasDiagnostic: observed.rejectionMessage?.includes(
          expected.diagnostic,
        ),
        rows: observed.rows,
        consoleCount: observed.consoleCalls.length,
        consolePrefix:
          typeof call?.context === 'string' &&
          call.context.includes('[QueryCollection] Error applying query'),
        consoleErrorName: call?.errorName,
        consoleErrorMessage: call?.errorMessage?.includes(
          '@tanstack/query-db-collection: queryFn must return an array of objects',
        ),
      },
      {
        invalidClass: true,
        messageHasDiagnostic: true,
        rows: [shared.id],
        consoleCount: 1,
        consolePrefix: true,
        consoleErrorName: 'InvalidQueryResultError',
        consoleErrorMessage: true,
      },
    ) ?? pass
  )
}
declareOracle({
  owns: [`src/query.ts#queryCollectionOptions`],
  model: [
    emptySettlementModel,
    deferredSettlementModel,
    cleanupSettlementModel,
    recoveredSettlementModel,
    eagerRecoveredSettlementModel,
    retainedInvalidSettlementModel,
    overlappingDeferralModel,
    independentSettlementModel,
    applicationFailureModel,
    handlerFailureModel,
    reentrantSettlementModel,
    invalidResultModel,
  ],
  check: [checkCuts, invalidResultCheck],
})
oracleProperty({
  id: 'query-db.ownership.application-failure',
  law: {
    statement: 'settles an application failure with throwOnError=$throwOnError',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{ throwOnError: true }, { throwOnError: false }],
  model: applicationFailureModel,
  driver: async ({ throwOnError }: { throwOnError: boolean }, observe) => {
    try {
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

      let actualOutcome: RefetchApplicationOutcome
      const refetch = collection.utils.refetch({ throwOnError })
      if (throwOnError) {
        const result = await settle(refetch)
        observe('refetch-return', {
          outcome: result.outcome,
          expectedError:
            result.outcome === 'rejected' && result.error === applicationError,
        })
        actualOutcome = result.outcome
      } else {
        const result = await settle(refetch)
        observe(
          'refetch-return',
          result.outcome === 'resolved'
            ? { outcome: result.outcome, length: result.value.length }
            : { outcome: result.outcome, expectedError: false },
        )
        actualOutcome = result.outcome
      }
      observe('application-outcome', actualOutcome)
      observe('explicit-refetch', {
        publicValues: { query: collection.get(shared.id)?.name },
        refetch: actualOutcome,
        ...(actualOutcome === `resolved`
          ? { resultOrder: [`query`] }
          : undefined),
      })
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.handler-failure',
  law: {
    statement:
      'records a handler-phase application failure after fetch settlement',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: handlerFailureModel,
  driver: async (_history, observe) => {
    try {
      const initial = { ...shared, name: `Initial` }
      const invalid = { ...shared, name: `Invalid` }
      const applicationError = new Error(`Handler application failed`)
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([initial])
        .mockResolvedValueOnce([invalid])
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
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
          },
        }),
      )
      cleanups.push(async () => {
        consoleError.mockRestore()
        await collection.cleanup()
        queryClient.clear()
      })
      await collection.stateWhenReady()

      const mutation = collection.update(shared.id, (draft) => {
        draft.name = `Optimistic`
      })
      await mutation.when(`settled`)

      if (
        !(await observeBoundary(
          observe,
          'application-error-recorded',
          () => reportedError(collection) === applicationError,
          (found) => found,
        ))
      )
        return

      observe('handler-boundary', {
        refetch: handlerOutcome,
        applicationErrorRecorded:
          reportedError(collection) === applicationError,
      })
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.empty-result',
  law: {
    statement: 'fulfills a public refetch after applying a valid empty result',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: emptySettlementModel,
  driver: async (_history, observe) => {
    try {
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

      observe('public:' + operation, {
        settled: true,
        outcome: `fulfilled`,
        rowCount: collection.size,
      })
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.reentrant-receipt',
  law: {
    statement:
      'keeps a same-result reentrant $receiptOutcome receipt attached to its refetch',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [`fulfilled`, `rejected`] as const,
  model: reentrantSettlementModel,
  driver: async (receiptOutcome, observe) => {
    try {
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
      observe('reentered', reentered)
      observe('nested-commits', reentrantCommitCount)
      observe('fetch-calls:2', queryFn.mock.calls.length)
      observe('refetch-pending', refetchOutcome)
      observe(
        'held-publications',
        publications.map((batch) => batch.map((change) => ({ ...change }))),
      )

      if (receiptOutcome === `fulfilled`) {
        reentrantApplication.resolve(undefined)
        const result = await settle(refetch)
        observe(
          'refetch-return',
          result.outcome === 'resolved'
            ? { outcome: result.outcome, length: result.value.length }
            : { outcome: result.outcome, expectedError: false },
        )
      } else {
        reentrantApplication.reject(applicationFailure)
        const result = await settle(refetch)
        observe('refetch-return', {
          outcome: result.outcome,
          expectedError:
            result.outcome === 'rejected' &&
            result.error === applicationFailure,
        })
      }

      observe('refetch-terminal', refetchOutcome)
      observe('applied-name', collection.get(shared.id)?.name)
      observe(
        'terminal-publications',
        publications.map((batch) => batch.map((change) => ({ ...change }))),
      )
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.invalid-result',
  law: {
    statement:
      'rejects a public refetch whose successful Query result has an invalid $invalidShape shape, throwOnError=$throwOnError',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [
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
  ] as const,
  model: invalidResultModel,
  driver: async (
    {
      throwOnError,
      invalidResult,
    }: { throwOnError: boolean; invalidResult: unknown; diagnostic: string },
    observe,
  ) => {
    try {
      const id = `invalid-result-settlement`
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([shared])
        .mockResolvedValueOnce(invalidResult as Array<Item>)
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

      observe('public:' + operation, await refetch)
      observe('invalid-diagnostics', {
        invalidClass: rejection instanceof InvalidQueryResultError,
        rejectionMessage:
          rejection instanceof Error ? rejection.message : undefined,
        rows: rows(collection),
        consoleCalls: consoleError.mock.calls.map(([context, error]) => ({
          context,
          errorName: diagnosticField(error, 'name'),
          errorMessage: diagnosticField(error, 'message'),
        })),
      })
    } finally {
      await runCleanups()
    }
  },
  check: invalidResultCheck,
})

oracleProperty({
  id: 'query-db.ownership.deferred-result',
  law: {
    statement:
      'keeps a deferred public refetch pending until its replacement applies',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: deferredSettlementModel,
  driver: async (_history, observe) => {
    try {
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

      if (
        !(await observeBoundary(
          observe,
          'fetch-calls:2',
          () => queryFn.mock.calls.length,
          (n) => n === 2,
        ))
      )
        return
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()

      const operation = `deferred-result`

      observe('public:' + operation, observation)
      observe('held-name', collection.get(shared.id)?.name)

      collection.deferDataRefresh = null
      barrier.resolve()
      if (
        !(await observeBoundary(
          observe,
          'fetch-calls:3',
          () => queryFn.mock.calls.length,
          (n) => n === 3,
        ))
      )
        return
      await refetch

      observe('public:' + operation, observation)
      observe('replacement-name', collection.get(shared.id)?.name)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.deferred-cleanup',
  law: {
    statement: 'cancels a deferred public refetch when cleanup retires it',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: cleanupSettlementModel,
  driver: async (_history, observe) => {
    try {
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
        () => ({
          observation: { settled: true, outcome: `fulfilled` as const },
        }),
        (error: unknown) => ({
          observation: { settled: true, outcome: `rejected` as const },
          error,
        }),
      )

      if (
        !(await observeBoundary(
          observe,
          'fetch-calls:2',
          () => queryFn.mock.calls.length,
          (n) => n === 2,
        ))
      )
        return
      const operation = `deferred-cleanup`

      await collection.cleanup()

      const result = await refetch
      observe('public:' + operation, result.observation)
      observe(
        'cancelled-error',
        isCancelledError('error' in result ? result.error : undefined),
      )
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.recovered-result',
  law: {
    statement:
      'does not reuse an invalid result rejection for a later valid refetch',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: recoveredSettlementModel,
  driver: async (_history, observe) => {
    try {
      const id = `recovered-result-settlement`
      const queryHash = hashKey([id])
      const persistedScan =
        createDeferred<
          Array<{ key: string | number; value: Item; metadata?: unknown }>
        >()
      const scanPersistedRows = vi.fn(() => persistedScan.promise)
      const invalidResult = 42 as unknown as Array<Item>
      const recovered = { ...shared, name: `Recovered` }
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
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

      try {
        const initialLoad = collection._sync.loadSubset({})
        const initialOutcome = await settle(
          Promise.resolve(initialLoad === true ? undefined : initialLoad),
        )
        observe(
          'initial-load-error',
          initialOutcome.outcome === 'rejected' &&
            initialOutcome.error instanceof InvalidQueryResultError,
        )

        const refetch = collection.utils.refetch({ throwOnError: true }).then(
          () => ({ settled: true, outcome: `fulfilled` as const }),
          () => ({ settled: true, outcome: `rejected` as const }),
        )
        if (
          !(await observeBoundary(
            observe,
            'recovery-work',
            () => ({
              queryCalls: queryFn.mock.calls.length,
              scanCalls: scanPersistedRows.mock.calls.length,
            }),
            (work) => work.queryCalls === 2 && work.scanCalls === 1,
          ))
        )
          return
        persistedScan.resolve([])

        observe('public:' + `recovered`, await refetch)
        await observeBoundary(
          observe,
          'recovered-name',
          () => collection.get(shared.id)?.name,
          (name) => name === recovered.name,
        )
      } finally {
        persistedScan.resolve([])
      }
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.eager-recovery',
  law: {
    statement:
      'does not reuse an eager initial rejection when a refetch applies a valid result',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: eagerRecoveredSettlementModel,
  driver: async (_history, observe) => {
    try {
      const id = `eager-recovered-result-settlement`
      const invalidResult = 42 as unknown as Array<Item>
      const recovered = { ...shared, name: `Recovered` }
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce(invalidResult)
        .mockResolvedValueOnce([recovered])
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
        }),
      )
      cleanups.push(async () => {
        consoleError.mockRestore()
        await collection.cleanup()
        queryClient.clear()
      })

      const initialOutcome = await settle(collection.stateWhenReady())
      observe(
        'initial-load-error',
        initialOutcome.outcome === 'rejected' &&
          initialOutcome.error instanceof InvalidQueryResultError,
      )

      observe('initial-error-status', {
        status: collection.status,
        errorDefined: reportedError(collection) !== undefined,
      })

      let rejection: unknown
      const recovery = collection.utils.refetch({ throwOnError: true }).then(
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
      if (
        !(await observeBoundary(
          observe,
          'fetch-calls:2',
          () => queryFn.mock.calls.length,
          (n) => n === 2,
        ))
      )
        return

      observe('public:' + `recovered`, await recovery)
      observe('recovery-error', rejection)
      // An initial error is final for its sync run. The refetch applies its
      // rows, but the Collection keeps its initial error until a restart.
      observe('recovered-state', {
        status: collection.status,
        errorDefined: reportedError(collection) !== undefined,
        name: collection.get(shared.id)?.name,
      })
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.retained-invalid',
  law: {
    statement:
      'rejects an invalid retained revalidation before its persisted baseline loads',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: retainedInvalidSettlementModel,
  driver: async (_history, observe) => {
    try {
      const id = `retained-invalid-result-settlement`
      const queryHash = hashKey([id])
      const persistedScan =
        createDeferred<
          Array<{ key: string | number; value: Item; metadata?: unknown }>
        >()
      const scanPersistedRows = vi.fn(() => persistedScan.promise)
      const invalidResult = 42 as unknown as Array<Item>
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
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
        if (
          !(await observeBoundary(
            observe,
            'initial-work',
            () => ({
              queryCalls: queryFn.mock.calls.length,
              scanCalls: scanPersistedRows.mock.calls.length,
            }),
            (work) => work.queryCalls === 1 && work.scanCalls === 1,
          ))
        )
          return

        let rejection: unknown
        const refetch = collection.utils.refetch({ throwOnError: true }).then(
          () => ({ settled: true, outcome: `fulfilled` as const }),
          (error: unknown) => {
            rejection = error
            return { settled: true, outcome: `rejected` as const }
          },
        )
        if (
          !(await observeBoundary(
            observe,
            'fetch-calls:2',
            () => queryFn.mock.calls.length,
            (n) => n === 2,
          ))
        )
          return

        const operation = `retained-invalid-result`

        observe('public:' + operation, await refetch)
        observe('invalid-error', rejection instanceof InvalidQueryResultError)
      } finally {
        persistedScan.resolve([])
        await initialLoadPromise.catch(() => undefined)
      }
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.overlapping-deferral',
  law: {
    statement:
      'keeps refetches pending when an older barrier refresh reaches a newer barrier',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: overlappingDeferralModel,
  driver: async (_history, observe) => {
    try {
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

      let firstObservation: PublicRefetchObservation = { settled: false }
      let secondObservation: PublicRefetchObservation = { settled: false }

      const barrierAPromise = barrierA.promise
      collection.deferDataRefresh = barrierAPromise
      const clearBarrierA = barrierAPromise.finally(() => {
        if (collection.deferDataRefresh === barrierAPromise) {
          collection.deferDataRefresh = null
        }
      })

      const first = collection.utils.refetch({ throwOnError: true }).then(
        () => {
          firstObservation = {
            settled: true,
            outcome: `fulfilled`,
            rowCount: 1,
          }
        },
        () => {
          firstObservation = { settled: true, outcome: `rejected` }
        },
      )
      if (
        !(await observeBoundary(
          observe,
          'first-skipped',
          () => ({
            queryCalls: queryFn.mock.calls.length,
            data: queryClient.getQueryData([id]),
          }),
          (value) =>
            value.queryCalls === 2 &&
            JSON.stringify(value.data) === JSON.stringify([skippedA]),
        ))
      )
        return

      const barrierBPromise = barrierB.promise
      collection.deferDataRefresh = barrierBPromise
      const clearBarrierB = barrierBPromise.finally(() => {
        if (collection.deferDataRefresh === barrierBPromise) {
          collection.deferDataRefresh = null
        }
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
      if (
        !(await observeBoundary(
          observe,
          'second-skipped',
          () => ({
            queryCalls: queryFn.mock.calls.length,
            data: queryClient.getQueryData([id]),
          }),
          (value) =>
            value.queryCalls === 3 &&
            JSON.stringify(value.data) === JSON.stringify([skippedB]),
        ))
      )
        return

      barrierA.resolve()
      await clearBarrierA
      if (
        !(await observeBoundary(
          observe,
          'fetch-calls:4',
          () => queryFn.mock.calls.length,
          (n) => n === 4,
        ))
      )
        return

      for (let turn = 0; turn < 20; turn++) await Promise.resolve()

      observe('public:' + `first`, firstObservation)
      observe('public:' + `second`, secondObservation)
      observe('held-name', collection.get(shared.id)?.name)

      barrierB.resolve()
      await clearBarrierB
      await Promise.all([first, second])
      observe('fetch-calls:5', queryFn.mock.calls.length)

      observe('public:' + `first`, firstObservation)
      observe('public:' + `second`, secondObservation)
      observe('replacement-name', collection.get(shared.id)?.name)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})

oracleProperty({
  id: 'query-db.ownership.independent-result',
  law: {
    statement:
      'settles a fresh applied refetch independently of an older deferred result',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior and the independent ownership result/call-settlement models.',
    limits:
      'Original bounded real QueryClient history and all its public/persistence/receipt cuts; no native SDK or transport retry claim.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: independentSettlementModel,
  driver: async (_history, observe) => {
    try {
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
      if (
        !(await observeBoundary(
          observe,
          'old-skipped',
          () => ({
            queryCalls: queryFn.mock.calls.length,
            data: queryClient.getQueryData([id]),
          }),
          (value) =>
            value.queryCalls === 2 &&
            JSON.stringify(value.data) === JSON.stringify([skipped]),
        ))
      )
        return

      collection.deferDataRefresh = null

      let freshObservation: PublicRefetchObservation = { settled: false }
      const freshRefetch = collection.utils
        .refetch({ throwOnError: true })
        .then(
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
      if (
        !(await observeBoundary(
          observe,
          'fresh-applied',
          () => ({
            queryCalls: queryFn.mock.calls.length,
            name: collection.get(shared.id)?.name,
          }),
          (value) => value.queryCalls === 3 && value.name === fresh.name,
        ))
      )
        return

      for (let turn = 0; turn < 20; turn++) await Promise.resolve()

      observe('public:' + `old`, oldObservation)
      observe('public:' + `fresh`, freshObservation)
      await collection.cleanup()
      barrier.resolve()
      await Promise.allSettled([oldRefetch, freshRefetch])
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'public result settlement'),
})
