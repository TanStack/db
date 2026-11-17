/** Ordinary examples of the independent model and its checker. These retain
 * every prior concrete expectation without presenting model-only checks as
 * production refinements or charging them as generated-history reach. */
import { expect, it } from 'vitest'
import {
  advanceResultSettlementModel,
  checkPostHandlerRefetch,
  createRefetchCallSettlementModel,
  expectExplicitRefetchObservation,
  expectHandlerIdentityObservation,
  expectPublicRefetchObservation,
  handlerCollectionHistoryGrammar,
  mutationRefreshHistoryGrammar,
  observeExplicitRefetchApplication,
  observeHandlerIdentity,
  observeHandlerRefetchBoundary,
  observeMutationRefreshLiveness,
  observeRefetchCallSettlement,
  reduceExplicitRefetchApplication,
  reduceMutationRefreshLiveness,
  reduceRefetchCallSettlement,
  startResultSettlementModel,
} from './ownership-model-oracle'
import type {
  ExplicitRefetchApplicationModel,
  ExplicitRefetchObservation,
  HandlerIdentityObservation,
  HandlerRefetchBoundaryModel,
  MutationRefreshLivenessModel,
} from './ownership-model-oracle'

it.each([`early-receipt`, `partial-rows`, `stale-waiter`] as const)(
  `rejects post-handler wrong observation: %s`,
  (fault) => {
    let model = createRefetchCallSettlementModel([`query`], true)
    model = reduceRefetchCallSettlement(model, {
      type: `accept-application`,
      queryId: `query`,
      applicationId: `later-result`,
    })
    model = reduceRefetchCallSettlement(model, {
      type: `settle-fetch`,
      queryId: `query`,
      outcome: `fulfilled`,
    })
    if (fault === `stale-waiter`)
      model = reduceRefetchCallSettlement(model, {
        type: `settle-application`,
        applicationId: `later-result`,
        outcome: `fulfilled`,
      })
    const actual = {
      refetch: observeRefetchCallSettlement(model),
      rows: `confirmed`,
      waiterRows: fault === `stale-waiter` ? `confirmed` : undefined,
    }
    checkPostHandlerRefetch(model, actual, `initial`, `confirmed`)
    if (fault === `early-receipt`)
      actual.refetch = { refetch: `resolved`, resultOrder: [`query`] }
    if (fault === `partial-rows`) actual.rows = `partial`
    if (fault === `stale-waiter`) actual.waiterRows = `initial`
    expect(() =>
      checkPostHandlerRefetch(model, actual, `initial`, `confirmed`),
    ).toThrow()
  },
)

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

it(`preserves every direct handler identity legacy replay coordinate`, () => {
  const historyKeys = handlerCollectionHistoryGrammar.map(
    ({ handlerKind, accessPath, legacyOperation }) =>
      `${handlerKind}:${accessPath}:${legacyOperation}`,
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
  // Six semantic histories each keep their two historical replay runs.
  expect(
    new Set(
      handlerCollectionHistoryGrammar.map(
        ({ handlerKind, accessPath }) => `${handlerKind}:${accessPath}`,
      ),
    ).size,
  ).toBe(6)
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

it(`rejects a call-entry-only boundary mutant for refresh-first overlap`, () => {
  const history = mutationRefreshHistoryGrammar.find(
    ({ invocation, legacyOperation, schedule }) =>
      invocation === `external-handler-overlap` &&
      legacyOperation === `refetch` &&
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

it(`preserves every mutation refresh legacy replay coordinate`, () => {
  expect(mutationRefreshHistoryGrammar).toHaveLength(12)
  expect(
    new Set(
      mutationRefreshHistoryGrammar.map(
        ({ invocation, legacyOperation, schedule }) =>
          `${invocation}:${legacyOperation}:${schedule}`,
      ),
    ).size,
  ).toBe(mutationRefreshHistoryGrammar.length)
  expect(
    new Set(
      mutationRefreshHistoryGrammar.map(
        ({ invocation, schedule }) => `${invocation}:${schedule}`,
      ),
    ).size,
  ).toBe(6)
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
