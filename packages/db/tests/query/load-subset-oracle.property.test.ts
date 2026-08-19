import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createTransaction } from '../../src/transactions.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { TraceAssertionError } from '../trace-runner.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type PredicateSpec =
  | { kind: `all` }
  | { kind: `eq`; value: number }
  | { kind: `in`; values: ReadonlyArray<number> }
  | {
      kind: `range`
      operator: `gt` | `gte` | `lt` | `lte`
      value: number
    }
  | { kind: `and` | `or`; operands: readonly [PredicateSpec, PredicateSpec] }
  | { kind: `not`; operand: PredicateSpec }

type AsyncScenario = {
  first: ReadonlyArray<number>
  second: ReadonlyArray<number>
  firstOutcome: `resolve` | `reject`
  secondOutcome: `resolve` | `reject`
  deliveryOrder: `forward` | `reverse`
  resetBeforeSettlement: boolean
}

type ConcurrentAsyncScenario = {
  requestedValues: ReadonlyArray<ReadonlyArray<number>>
  deliveryOrder: `forward` | `reverse`
}

type RangeOperator = Extract<PredicateSpec, { kind: `range` }>[`operator`]

type WindowRequest = {
  where?: PredicateSpec
  orderField?: `none` | `rank` | `score`
  direction: `asc` | `desc`
  nulls?: `first` | `last`
  stringSort?: `lexical` | `locale`
  offset: number
  limit?: number
}

type PersistedLoadRow = {
  id: string
  projectId: string
}

type OptimisticDerivedRow = {
  id: string
  value: string
}

type CoverageSubject = {
  loadSubset: (options: LoadSubsetOptions) => true | Promise<void>
  reset?: () => void
}

type CoverageSubjectFactory = (
  recordLoad: (options: LoadSubsetOptions) => true | Promise<void>,
) => CoverageSubject

class CoveredDemandRefetchedError extends Error {
  constructor(
    readonly checkpoint: number,
    readonly requested: ReadonlySet<number>,
    readonly loadedRegions: ReadonlyArray<ReadonlySet<number>>,
    readonly requestedFingerprint: string,
    readonly loadedRegionFingerprints: ReadonlyArray<string>,
  ) {
    super(`Covered demand refetched at checkpoint ${checkpoint}`)
  }
}

class UncoveredWindowDeduplicatedError extends Error {
  constructor(
    readonly checkpoint: number,
    readonly requested: WindowRequest,
    readonly loadedRegions: ReadonlyArray<{
      request: WindowRequest
      positions: ReadonlySet<number>
    }>,
  ) {
    super(`Uncovered window deduplicated at checkpoint ${checkpoint}`)
  }
}

class CoveredWindowRefetchedError extends Error {
  constructor(
    readonly checkpoint: number,
    readonly requested: WindowRequest,
    readonly requestedPositions: ReadonlySet<number>,
    readonly loadedRegions: ReadonlyArray<{
      request: WindowRequest
      positions: ReadonlySet<number>
    }>,
  ) {
    super(`Covered window refetched at checkpoint ${checkpoint}`)
  }
}

// The generated predicates only compare against integers from -3 through 3.
// These points cover every distinct truth partition: both unbounded tails,
// every equality point, and every open interval between adjacent thresholds.
const valueDomain = [
  -4, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4,
] as const
const scoreRef = new PropRef<number>([`score`])
const rankRef = new PropRef<number>([`rank`])

const atomicPredicateSpecArbitrary: fc.Arbitrary<PredicateSpec> = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ kind: `all` as const }) },
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: -3, max: 3 })
      .map((value) => ({ kind: `eq` as const, value })),
  },
  {
    weight: 3,
    arbitrary: fc
      .uniqueArray(fc.integer({ min: -3, max: 3 }), {
        minLength: 0,
        maxLength: 7,
      })
      .map((values) => ({ kind: `in` as const, values })),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant(`range` as const),
      operator: fc.constantFrom<RangeOperator>(`gt`, `gte`, `lt`, `lte`),
      value: fc.integer({ min: -3, max: 3 }),
    }),
  },
)

const predicateSpecArbitrary: fc.Arbitrary<PredicateSpec> = fc.oneof(
  { weight: 8, arbitrary: atomicPredicateSpecArbitrary },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constantFrom(`and` as const, `or` as const),
      operands: fc.tuple(
        atomicPredicateSpecArbitrary,
        atomicPredicateSpecArbitrary,
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: atomicPredicateSpecArbitrary.map((operand) => ({
      kind: `not` as const,
      operand,
    })),
  },
)

const requestTraceArbitrary = fc.array(predicateSpecArbitrary, {
  minLength: 1,
  maxLength: 20,
})

const nonEmptyInValuesArbitrary = fc.uniqueArray(
  fc.integer({ min: -3, max: 3 }),
  { minLength: 1, maxLength: 7 },
)

// A rejected request with an in-flight deduplicated waiter currently creates a
// detached rejected promise inside DeduplicatedLoadSubset. Keep that discovered
// defect out of this green settlement corpus; it is pinned separately below.
const asyncScenarioArbitrary: fc.Arbitrary<AsyncScenario> = fc
  .record({
    first: nonEmptyInValuesArbitrary,
    second: nonEmptyInValuesArbitrary,
    firstOutcome: fc.constantFrom<AsyncScenario[`firstOutcome`]>(
      `resolve`,
      `reject`,
    ),
    secondOutcome: fc.constantFrom<AsyncScenario[`secondOutcome`]>(
      `resolve`,
      `reject`,
    ),
    deliveryOrder: fc.constantFrom<AsyncScenario[`deliveryOrder`]>(
      `forward`,
      `reverse`,
    ),
    resetBeforeSettlement: fc.boolean(),
  })
  .map((scenario) =>
    scenario.firstOutcome === `reject` &&
    scenario.second.every((value) => scenario.first.includes(value))
      ? { ...scenario, firstOutcome: `resolve` }
      : scenario,
  )

const concurrentAsyncScenarioArbitrary: fc.Arbitrary<ConcurrentAsyncScenario> =
  fc.record({
    requestedValues: fc.array(nonEmptyInValuesArbitrary, {
      minLength: 3,
      maxLength: 5,
    }),
    deliveryOrder: fc.constantFrom(`forward`, `reverse`),
  })

const windowRequestArbitrary: fc.Arbitrary<Omit<WindowRequest, `where`>> =
  fc.record({
    orderField: fc.constantFrom(`none`, `rank`, `score`),
    direction: fc.constantFrom(`asc`, `desc`),
    nulls: fc.constantFrom(`first`, `last`),
    stringSort: fc.constantFrom(`lexical`, `locale`),
    offset: fc.integer({ min: 0, max: 6 }),
    limit: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
  })

const windowTraceArbitrary = fc
  .record({
    where: fc.option(predicateSpecArbitrary, { nil: undefined }),
    requests: fc.array(windowRequestArbitrary, {
      minLength: 1,
      maxLength: 20,
    }),
  })
  .map(({ where, requests }) =>
    requests.map((request) => ({ ...request, where })),
  )

const distinctWindowWherePairArbitrary = fc
  .tuple(predicateSpecArbitrary, predicateSpecArbitrary)
  .filter(
    ([first, second]) =>
      !isSubset(
        matchingValues(toWhere(first)),
        matchingValues(toWhere(second)),
      ) ||
      !isSubset(
        matchingValues(toWhere(second)),
        matchingValues(toWhere(first)),
      ),
  )

function toWhere(
  predicate: PredicateSpec,
): BasicExpression<boolean> | undefined {
  switch (predicate.kind) {
    case `all`:
      return undefined
    case `eq`:
      return new Func(`eq`, [scoreRef, new Value(predicate.value)])
    case `in`:
      return new Func(`in`, [scoreRef, new Value([...predicate.values])])
    case `range`:
      return new Func(predicate.operator, [
        scoreRef,
        new Value(predicate.value),
      ])
    case `and`:
    case `or`:
      return new Func(predicate.kind, predicate.operands.map(toRequiredWhere))
    case `not`:
      return new Func(`not`, [toRequiredWhere(predicate.operand)])
  }
}

function toRequiredWhere(predicate: PredicateSpec): BasicExpression<boolean> {
  return toWhere(predicate) ?? new Value(true)
}

function evaluateExpression(
  expression: BasicExpression,
  score: number,
): unknown {
  switch (expression.type) {
    case `ref`:
      if (expression.path.at(-1) !== `score`) {
        throw new Error(`Unsupported reference: ${expression.path.join(`.`)}`)
      }
      return score
    case `val`:
      return expression.value
    case `func`: {
      const args = expression.args.map((argument) =>
        evaluateExpression(argument, score),
      )
      switch (expression.name) {
        case `eq`:
          return args[0] === args[1]
        case `gt`:
          return Number(args[0]) > Number(args[1])
        case `gte`:
          return Number(args[0]) >= Number(args[1])
        case `lt`:
          return Number(args[0]) < Number(args[1])
        case `lte`:
          return Number(args[0]) <= Number(args[1])
        case `in`:
          if (!Array.isArray(args[1])) {
            throw new Error(`IN requires an array`)
          }
          return args[1].includes(args[0])
        case `and`:
          return args.every(Boolean)
        case `or`:
          return args.some(Boolean)
        case `not`:
          return !args[0]
        default:
          throw new Error(`Unsupported predicate function: ${expression.name}`)
      }
    }
  }
}

function matchingValues(
  where: BasicExpression<boolean> | undefined,
): Set<number> {
  return new Set(
    valueDomain.filter(
      (score) =>
        where === undefined || evaluateExpression(where, score) === true,
    ),
  )
}

function difference(left: ReadonlySet<number>, right: ReadonlySet<number>) {
  return new Set([...left].filter((value) => !right.has(value)))
}

function isSubset(left: ReadonlySet<number>, right: ReadonlySet<number>) {
  return [...left].every((value) => right.has(value))
}

function expectSetEqual(
  actual: ReadonlySet<number>,
  expected: ReadonlySet<number>,
): void {
  expect([...actual].sort()).toEqual([...expected].sort())
}

const createDeduplicatedCoverageSubject: CoverageSubjectFactory = (
  recordLoad,
) => new DeduplicatedLoadSubset({ loadSubset: recordLoad })

const createAlwaysLoadingCoverageSubject: CoverageSubjectFactory = (
  recordLoad,
) => ({ loadSubset: recordLoad })

const createRefetchAfterSettlementSubject: CoverageSubjectFactory = (
  recordLoad,
) => {
  let hasSettled = false
  const dedupe = new DeduplicatedLoadSubset({ loadSubset: recordLoad })
  return {
    loadSubset: (options) => {
      if (hasSettled) return recordLoad(options)
      const result = dedupe.loadSubset(options)
      if (result instanceof Promise) {
        void result.then(
          () => {
            hasSettled = true
          },
          () => {
            hasSettled = true
          },
        )
      }
      return result
    },
    reset: () => dedupe.reset(),
  }
}

function runCoverageTrace(
  trace: ReadonlyArray<PredicateSpec>,
  createSubject = createDeduplicatedCoverageSubject,
): void {
  const covered = new Set<number>()
  const loadedRegions: Array<Set<number>> = []
  const loadedRegionFingerprints: Array<string> = []
  const loads: Array<LoadSubsetOptions> = []
  const subject = createSubject((options) => {
    loads.push(options)
    return true
  })

  for (const [checkpoint, predicate] of trace.entries()) {
    const where = toWhere(predicate)
    const requested = matchingValues(where)
    const missing = difference(requested, covered)
    const loadCountBefore = loads.length

    const result = subject.loadSubset({ where })

    expect(result).toBe(true)
    expect(loads.length - loadCountBefore).toBeLessThanOrEqual(1)
    if (loads.length === loadCountBefore) {
      expect(missing.size).toBe(0)
    } else {
      expect(loads).toHaveLength(loadCountBefore + 1)
      const loaded = matchingValues(loads.at(-1)?.where)
      expectSetEqual(difference(loaded, requested), new Set())
      if (missing.size === 0) {
        throw new CoveredDemandRefetchedError(
          checkpoint,
          requested,
          loadedRegions.map((region) => new Set(region)),
          JSON.stringify(predicate),
          [...loadedRegionFingerprints],
        )
      }
      expectSetEqual(difference(missing, loaded), new Set())
      for (const value of loaded) covered.add(value)
      loadedRegions.push(loaded)
      loadedRegionFingerprints.push(JSON.stringify(predicate))
    }

    expectSetEqual(difference(requested, covered), new Set())
  }
}

function runCoverageTraceWithKnownFailures(
  trace: ReadonlyArray<PredicateSpec>,
  createSubject = createDeduplicatedCoverageSubject,
): void {
  try {
    runCoverageTrace(trace, createSubject)
  } catch (error) {
    if (
      error instanceof CoveredDemandRefetchedError &&
      isKnownUnionCompositionRefetch(error)
    ) {
      return
    }
    throw error
  }
}

function isKnownUnionCompositionRefetch(
  error: CoveredDemandRefetchedError,
): boolean {
  if (error.requested.size === 0) return true
  // The error can only be built after the independent model proves the demand
  // is already covered. Once two unlimited regions have been composed, the
  // current implementation can refetch any later covered demand, including a
  // strict subset of one original region. Fixed traces below make this waiver
  // expire when that product defect is repaired.
  if (error.loadedRegions.length > 1) return true

  const usesCompoundPredicate = [
    error.requestedFingerprint,
    ...error.loadedRegionFingerprints,
  ].some((fingerprint) => /"kind":"(?:and|or|not)"/.test(fingerprint))
  return (
    usesCompoundPredicate &&
    error.loadedRegionFingerprints[0] !== error.requestedFingerprint
  )
}

function countLoads(trace: ReadonlyArray<PredicateSpec>): number {
  let loads = 0
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => {
      loads++
      return true
    },
  })
  for (const predicate of trace) {
    dedupe.loadSubset({ where: toWhere(predicate) })
  }
  return loads
}

function toWindowOptions(request: WindowRequest): LoadSubsetOptions {
  const orderField = request.orderField ?? `rank`
  return {
    where: request.where ? toWhere(request.where) : undefined,
    offset: request.offset,
    limit: request.limit,
    orderBy:
      orderField === `none`
        ? undefined
        : [
            {
              expression: orderField === `rank` ? rankRef : scoreRef,
              compareOptions: {
                direction: request.direction,
                nulls: request.nulls ?? `last`,
                stringSort: request.stringSort ?? `lexical`,
              },
            },
          ],
  }
}

function windowPositions(request: WindowRequest): Set<number> {
  if (request.where?.kind === `in` && request.where.values.length === 0) {
    return new Set()
  }
  // The coverage oracle needs a finite universe. Generated finite windows end
  // at position 11, so 16 positions preserve every generated subset relation
  // while giving an omitted limit an authoritative "through the end" region.
  const length = request.limit ?? 16 - request.offset
  return new Set(Array.from({ length }, (_, index) => request.offset + index))
}

function loadedWindowCovers(
  requested: WindowRequest,
  loaded: WindowRequest,
): boolean {
  const requestedOptions = toWindowOptions(requested)
  const loadedOptions = toWindowOptions(loaded)
  // An unlimited load has every row in its predicate region. It can therefore
  // cover any narrower predicate and let local query processing impose the
  // requested order and window.
  if (
    loaded.limit === undefined &&
    isSubset(
      matchingValues(requestedOptions.where),
      matchingValues(loadedOptions.where),
    )
  ) {
    return true
  }
  if (
    JSON.stringify(requestedOptions.where) !==
    JSON.stringify(loadedOptions.where)
  ) {
    return false
  }
  if (!requestedOptions.orderBy?.length) return true
  if (!loadedOptions.orderBy?.length) return false
  return (
    JSON.stringify(requestedOptions.orderBy) ===
    JSON.stringify(loadedOptions.orderBy)
  )
}

function isKnownCompareOptionsDeduplication(
  error: UncoveredWindowDeduplicatedError,
): boolean {
  const requestedOptions = toWindowOptions(error.requested)
  const requestedOrder = requestedOptions.orderBy?.[0]
  if (!requestedOrder) return false
  const requestedPositions = windowPositions(error.requested)

  return error.loadedRegions.some(({ request: loaded, positions }) => {
    const loadedOptions = toWindowOptions(loaded)
    const loadedOrder = loadedOptions.orderBy?.[0]
    return (
      loadedOrder !== undefined &&
      JSON.stringify(requestedOptions.where) ===
        JSON.stringify(loadedOptions.where) &&
      JSON.stringify(requestedOrder.expression) ===
        JSON.stringify(loadedOrder.expression) &&
      requestedOrder.compareOptions.direction ===
        loadedOrder.compareOptions.direction &&
      (requestedOrder.compareOptions.nulls !==
        loadedOrder.compareOptions.nulls ||
        requestedOrder.compareOptions.stringSort !==
          loadedOrder.compareOptions.stringSort) &&
      isSubset(requestedPositions, positions)
    )
  })
}

function isKnownUnlimitedOffsetDeduplication(
  error: UncoveredWindowDeduplicatedError,
): boolean {
  const requestedOptions = toWindowOptions(error.requested)

  return error.loadedRegions.some(({ request: loaded }) => {
    if (loaded.limit !== undefined || loaded.offset <= error.requested.offset) {
      return false
    }
    const loadedOptions = toWindowOptions(loaded)
    return isSubset(
      matchingValues(requestedOptions.where),
      matchingValues(loadedOptions.where),
    )
  })
}

function isKnownCoveredWindowRefetch(
  error: CoveredWindowRefetchedError,
): boolean {
  if (
    error.requestedPositions.size === 0 &&
    (error.requested.limit === 0 ||
      (error.requested.where?.kind === `in` &&
        error.requested.where.values.length === 0))
  ) {
    return true
  }
  if (error.loadedRegions.length > 1) return true
  if (error.requested.where === undefined) return false

  return error.loadedRegions.some(
    ({ request: loaded, positions }) =>
      loadedWindowCovers(error.requested, loaded) &&
      isSubset(error.requestedPositions, positions),
  )
}

const createWindowKeyBlindSubject: CoverageSubjectFactory = (recordLoad) => {
  const coveredWindows = new Set<string>()
  return {
    loadSubset: (options) => {
      const key = JSON.stringify({
        offset: options.offset ?? 0,
        limit: options.limit,
      })
      if (coveredWindows.has(key)) return true
      coveredWindows.add(key)
      return recordLoad(options)
    },
  }
}

function runWindowCoverageTrace(
  trace: ReadonlyArray<WindowRequest>,
  createSubject = createDeduplicatedCoverageSubject,
): void {
  const loadedRegions: Array<{
    request: WindowRequest
    positions: Set<number>
  }> = []
  const loads: Array<LoadSubsetOptions> = []
  const subject = createSubject((options) => {
    loads.push(options)
    return true
  })

  for (const [checkpoint, request] of trace.entries()) {
    const requested = windowPositions(request)
    const compatibleRegions = loadedRegions.filter(({ request: loaded }) =>
      loadedWindowCovers(request, loaded),
    )
    const covered = new Set(
      compatibleRegions.flatMap(({ positions }) => [...positions]),
    )
    const missing = difference(requested, covered)
    const callsBefore = loads.length

    subject.loadSubset(toWindowOptions(request))

    expect(loads.length - callsBefore).toBeLessThanOrEqual(1)
    if (loads.length === callsBefore) {
      if (missing.size > 0) {
        throw new UncoveredWindowDeduplicatedError(
          checkpoint,
          request,
          loadedRegions.map(({ request: loaded, positions }) => ({
            request: { ...loaded },
            positions: new Set(positions),
          })),
        )
      }
    } else {
      const loaded = loads.at(-1)!
      expect(loaded).toEqual(toWindowOptions(request))
      if (missing.size === 0) {
        throw new CoveredWindowRefetchedError(
          checkpoint,
          { ...request },
          new Set(requested),
          compatibleRegions.map(({ request: previous, positions }) => ({
            request: { ...previous },
            positions: new Set(positions),
          })),
        )
      }
      for (const position of requested) covered.add(position)
      loadedRegions.push({ request: { ...request }, positions: requested })
    }
    expectSetEqual(difference(requested, covered), new Set())
  }
}

function runWindowCoverageTraceWithKnownFailures(
  trace: ReadonlyArray<WindowRequest>,
  createSubject = createDeduplicatedCoverageSubject,
): void {
  try {
    runWindowCoverageTrace(trace, createSubject)
  } catch (error) {
    if (
      error instanceof UncoveredWindowDeduplicatedError &&
      (isKnownCompareOptionsDeduplication(error) ||
        isKnownUnlimitedOffsetDeduplication(error))
    ) {
      return
    }
    if (
      error instanceof CoveredWindowRefetchedError &&
      isKnownCoveredWindowRefetch(error)
    ) {
      return
    }
    throw error
  }
}

function countWindowLoads(trace: ReadonlyArray<WindowRequest>): number {
  let loads = 0
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => {
      loads++
      return true
    },
  })
  for (const request of trace) dedupe.loadSubset(toWindowOptions(request))
  return loads
}

function expectDistinctWhereStartsDistinctLimitedWindowLoads(
  predicates: readonly [PredicateSpec, PredicateSpec],
): void {
  const createRequest = (where: PredicateSpec): WindowRequest => ({
    where,
    orderField: `rank`,
    direction: `asc`,
    nulls: `last`,
    stringSort: `lexical`,
    offset: 0,
    limit: 2,
  })
  expect(countWindowLoads(predicates.map(createRequest))).toBe(2)
}

async function runAsyncScenario(
  scenario: AsyncScenario,
  createSubject: CoverageSubjectFactory = createDeduplicatedCoverageSubject,
): Promise<void> {
  const requests: Array<{
    options: LoadSubsetOptions
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  const subject = createSubject((options) => {
    const deferred = createDeferred<void>()
    // The source promise is intentionally rejectable. Observe it directly as
    // well as through the dedupe wrapper so Vitest never mistakes a generated
    // transport rejection for an unhandled test error.
    void deferred.promise.catch(() => undefined)
    requests.push({ options, deferred })
    return deferred.promise
  })

  const firstResult = subject.loadSubset({
    where: toWhere({ kind: `in`, values: scenario.first }),
  })
  const secondResult = subject.loadSubset({
    where: toWhere({ kind: `in`, values: scenario.second }),
  })
  expect(firstResult).toBeInstanceOf(Promise)
  expect(secondResult).toBeInstanceOf(Promise)
  if (!(firstResult instanceof Promise) || !(secondResult instanceof Promise)) {
    throw new Error(`Initial async requests must return promises`)
  }

  const firstSet = new Set(scenario.first)
  const secondSet = new Set(scenario.second)
  const secondCoveredByFirst = isSubset(secondSet, firstSet)
  expect(requests).toHaveLength(secondCoveredByFirst ? 1 : 2)
  expect(firstResult === secondResult).toBe(secondCoveredByFirst)

  if (scenario.resetBeforeSettlement) subject.reset?.()

  const outcomes = [scenario.firstOutcome, scenario.secondOutcome] as const
  const deliveryIndices =
    scenario.deliveryOrder === `forward`
      ? requests.map((_, index) => index)
      : requests.map((_, index) => index).reverse()
  const callerOutcomePromise = Promise.allSettled([firstResult, secondResult])
  for (const index of deliveryIndices) {
    const request = requests[index]!
    const outcome = outcomes[index]!
    if (outcome === `resolve`) request.deferred.resolve()
    else request.deferred.reject(new Error(`request ${index} failed`))
  }

  const callerOutcomes = await callerOutcomePromise
  const expectedFirstStatus =
    scenario.firstOutcome === `resolve` ? `fulfilled` : `rejected`
  const expectedSecondStatus = secondCoveredByFirst
    ? expectedFirstStatus
    : scenario.secondOutcome === `resolve`
      ? `fulfilled`
      : `rejected`
  expect(callerOutcomes.map(({ status }) => status)).toEqual([
    expectedFirstStatus,
    expectedSecondStatus,
  ])

  const successfullyCovered = new Set<number>()
  if (!scenario.resetBeforeSettlement) {
    if (scenario.firstOutcome === `resolve`) {
      for (const value of firstSet) successfullyCovered.add(value)
    }
    if (!secondCoveredByFirst && scenario.secondOutcome === `resolve`) {
      for (const value of secondSet) successfullyCovered.add(value)
    }
  }

  const callsBeforeRetry = requests.length
  const retry = subject.loadSubset({
    where: toWhere({ kind: `in`, values: scenario.second }),
  })
  const retryWasCovered = isSubset(secondSet, successfullyCovered)
  if (retry === true) {
    expect(retryWasCovered).toBe(true)
    expect(retry).toBe(true)
    expect(requests).toHaveLength(callsBeforeRetry)
  } else {
    try {
      expect(retryWasCovered).toBe(false)
    } catch (error) {
      throw new TraceAssertionError(2, error)
    }
    expect(retry).toBeInstanceOf(Promise)
    expect(requests).toHaveLength(callsBeforeRetry + 1)
    const retriedValues = matchingValues(requests.at(-1)?.options.where)
    const missingRetryValues = difference(secondSet, successfullyCovered)
    expectSetEqual(difference(missingRetryValues, retriedValues), new Set())
    expectSetEqual(difference(retriedValues, secondSet), new Set())
    requests.at(-1)?.deferred.resolve()
    await retry
  }
}

async function runConcurrentAsyncScenario(
  scenario: ConcurrentAsyncScenario,
): Promise<void> {
  const transports: Array<{
    values: Set<number>
    deferred: ReturnType<typeof createDeferred<void>>
    result?: Promise<void>
  }> = []
  const subject = createDeduplicatedCoverageSubject((options) => {
    const deferred = createDeferred<void>()
    transports.push({ values: matchingValues(options.where), deferred })
    return deferred.promise
  })
  const callerResults: Array<Promise<void>> = []

  for (const values of scenario.requestedValues) {
    const requested = new Set(values)
    const coveringIndex = transports.findIndex(({ values: loaded }) =>
      isSubset(requested, loaded),
    )
    const transportCount = transports.length
    const result = subject.loadSubset({
      where: toWhere({ kind: `in`, values }),
    })
    expect(result).toBeInstanceOf(Promise)
    if (!(result instanceof Promise)) {
      throw new Error(`Concurrent async requests must remain pending`)
    }
    callerResults.push(result)

    if (coveringIndex === -1) {
      expect(transports).toHaveLength(transportCount + 1)
      transports.at(-1)!.result = result
    } else {
      expect(transports).toHaveLength(transportCount)
      expect(result).toBe(transports[coveringIndex]!.result)
    }
  }

  const delivery =
    scenario.deliveryOrder === `forward`
      ? transports
      : [...transports].reverse()
  for (const { deferred } of delivery) deferred.resolve()
  await Promise.all(callerResults)
}

async function runAsyncScenarioWithKnownFailures(
  scenario: AsyncScenario,
): Promise<void> {
  try {
    await runAsyncScenario(scenario)
  } catch (error) {
    if (
      error instanceof TraceAssertionError &&
      error.checkpoint === 2 &&
      !scenario.resetBeforeSettlement &&
      scenario.firstOutcome === `resolve` &&
      scenario.secondOutcome === `resolve` &&
      !isSubset(new Set(scenario.second), new Set(scenario.first))
    ) {
      return
    }
    throw error
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function readSeed(): number | undefined {
  const raw = process.env.TANSTACK_DB_ORACLE_SEED
  if (raw === undefined) return undefined

  const seed = Number(raw)
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`TANSTACK_DB_ORACLE_SEED must be an integer`)
  }
  return seed
}

const runs = 40 * readPositiveInteger(`TANSTACK_DB_ORACLE_RUNS_MULTIPLIER`, 1)
const replaySeed = readSeed()
const randomParameters =
  replaySeed === undefined
    ? { numRuns: runs }
    : { numRuns: runs, seed: replaySeed }

let collectionSequence = 0

async function expectPersistingLoadIsApplied(persisting: boolean) {
  const rows: Array<PersistedLoadRow> = [
    { id: `r1`, projectId: `p1` },
    { id: `r2`, projectId: `p1` },
  ]
  let loadCalls = 0
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-oracle-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            loadCalls += 1
            begin()
            for (const row of rows) {
              write({ type: `insert`, value: { ...row } })
            }
            commit()
            return Promise.resolve()
          },
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  if (persisting) {
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    expect(transaction.state).toBe(`persisting`)
  }
  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
  )

  try {
    const result = await live.toArrayWhenReady()
    expect(loadCalls).toBe(1)
    try {
      expect(result.map(({ id }) => id).sort()).toEqual([`r1`, `r2`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    if (persisting) {
      persistence.resolve()
      await transaction.isPersisted.promise
    }
    live.cleanup()
    source.cleanup()
  }
}

async function expectDerivedSyncDuringOptimisticMutation(): Promise<void> {
  let begin!: () => void
  let write!: (message: { type: `insert`; value: OptimisticDerivedRow }) => void
  let commit!: () => void
  const source = createCollection<OptimisticDerivedRow>({
    id: `optimistic-derived-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
      },
    },
  })
  const derived = createLiveQueryCollection({
    query: (query) =>
      query
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, value: row.value })),
    getKey: (row) => row.id,
    startSync: true,
  })
  const persistence = createDeferred<void>()
  // Query collections currently expose read-side virtual properties in their
  // insert input type even though the runtime accepts the plain selected row.
  const insertDerived = derived.insert.bind(derived) as unknown as (
    row: OptimisticDerivedRow,
  ) => ReturnType<typeof derived.insert>
  const insertOptimistically = createOptimisticAction<OptimisticDerivedRow>({
    onMutate: insertDerived,
    mutationFn: () => persistence.promise,
  })

  await derived.preload()
  const transaction = insertOptimistically({
    id: `optimistic`,
    value: `optimistic`,
  })
  try {
    begin()
    write({ type: `insert`, value: { id: `synced`, value: `synced` } })
    commit()

    try {
      expect([...derived.keys()].sort()).toEqual([`optimistic`, `synced`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise
    derived.cleanup()
    source.cleanup()
  }
}

async function expectDeduplicatedWaiterHandlesRejection(): Promise<void> {
  const detachedBranches: Array<Promise<unknown>> = []
  class LocallyTrackedPromise<T> extends Promise<T> {
    catch<TResult = never>(
      onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): Promise<T | TResult> {
      const branch = super.catch(onRejected)
      detachedBranches.push(branch)
      return branch
    }
  }

  let rejectSource!: (reason?: unknown) => void
  const sourcePromise = new LocallyTrackedPromise<void>((_resolve, reject) => {
    rejectSource = reject
  })
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => sourcePromise,
  })

  const first = dedupe.loadSubset({
    where: toWhere({ kind: `in`, values: [1, 2] }),
  })
  const second = dedupe.loadSubset({
    where: toWhere({ kind: `eq`, value: 1 }),
  })
  if (!(first instanceof Promise) || !(second instanceof Promise)) {
    throw new Error(`Both callers must wait for the in-flight request`)
  }

  const callerOutcomes = Promise.allSettled([first, second])
  const detachedOutcomes = Promise.allSettled(detachedBranches)
  rejectSource(new Error(`transport failed`))
  expect((await callerOutcomes).map(({ status }) => status)).toEqual([
    `rejected`,
    `rejected`,
  ])

  try {
    expect({
      branchCount: detachedBranches.length,
      statuses: (await detachedOutcomes).map(({ status }) => status),
    }).toEqual({ branchCount: 1, statuses: [`fulfilled`] })
  } catch (error) {
    throw new TraceAssertionError(0, error)
  }
}

describe(`loadSubset coverage oracle`, () => {
  it(
    `discovered trace: an empty predicate issues no transport work`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(countLoads([{ kind: `in`, values: [] }])).toBe(0)
        }),
      { message: /expected 1 to be/ },
    ),
  )

  it(
    `discovered trace: an empty ordered window issues no transport work`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countWindowLoads([{ direction: `asc`, offset: 0, limit: 0 }]),
          ).toBe(0)
        }),
      { message: /expected 1 to be/ },
    ),
  )

  it(
    `discovered trace: an empty filtered window issues no transport work`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countWindowLoads([
              {
                where: { kind: `in`, values: [] },
                direction: `asc`,
                offset: 0,
                limit: 1,
              },
            ]),
          ).toBe(0)
        }),
      { message: /expected 1 to be/ },
    ),
  )

  it(
    `discovered trace: widening an unlimited offset starts another load`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countWindowLoads([
              { direction: `asc`, offset: 1, limit: undefined },
              { direction: `asc`, offset: 0, limit: undefined },
            ]),
          ).toBe(2)
        }),
      { message: /expected 1 to be/ },
    ),
  )

  it(
    `discovered trace: an identical filtered window reuses its load`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          const request: WindowRequest = {
            where: { kind: `in`, values: [0] },
            orderField: `none`,
            direction: `asc`,
            offset: 0,
            limit: 1,
          }
          expect(countWindowLoads([request, request])).toBe(1)
        }),
      { message: /expected 2 to be/ },
    ),
  )

  it(`rejects repeated transport work for one covered predicate`, () => {
    expect(() =>
      runCoverageTrace(
        [
          { kind: `eq`, value: 1 },
          { kind: `eq`, value: 1 },
        ],
        createAlwaysLoadingCoverageSubject,
      ),
    ).toThrow()
  })

  it(`reuses transport work for repeated and strictly covered predicates`, () => {
    runCoverageTrace([
      { kind: `range`, operator: `gte`, value: 0 },
      ...Array.from(
        { length: 20 },
        (): PredicateSpec => ({ kind: `eq`, value: 1 }),
      ),
    ])
  })

  it(`rejects transport work for a strict covered predicate subset`, () => {
    expect(() =>
      runCoverageTrace(
        [
          { kind: `range`, operator: `gte`, value: 0 },
          { kind: `eq`, value: 1 },
        ],
        createAlwaysLoadingCoverageSubject,
      ),
    ).toThrow()
  })

  it(
    `discovered trace: a covered compound predicate issues no second load`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          try {
            expect(
              countLoads([
                {
                  kind: `and`,
                  operands: [
                    { kind: `range`, operator: `gte`, value: 0 },
                    { kind: `not`, operand: { kind: `eq`, value: 2 } },
                  ],
                },
                {
                  kind: `or`,
                  operands: [
                    { kind: `eq`, value: 1 },
                    { kind: `eq`, value: 3 },
                  ],
                },
              ]),
            ).toBe(1)
          } catch (error) {
            throw new TraceAssertionError(0, error)
          }
        }),
      {
        checkpoint: 0,
        classify: ({ actual, expected }) => actual === 2 && expected === 1,
      },
    ),
  )

  it(`rejects repeated transport work for one identical compound predicate`, () => {
    const predicate: PredicateSpec = {
      kind: `and`,
      operands: [
        { kind: `range`, operator: `gte`, value: 0 },
        { kind: `not`, operand: { kind: `eq`, value: 2 } },
      ],
    }
    expect(() =>
      runCoverageTraceWithKnownFailures(
        [predicate, predicate],
        createAlwaysLoadingCoverageSubject,
      ),
    ).toThrow()
  })

  it(`rejects repeated transport work for one covered window`, () => {
    expect(() =>
      runWindowCoverageTrace(
        [
          { direction: `asc`, offset: 1, limit: 2 },
          { direction: `asc`, offset: 1, limit: 2 },
        ],
        createAlwaysLoadingCoverageSubject,
      ),
    ).toThrow()
  })

  it(`reuses transport work for repeated and strictly covered windows`, () => {
    runWindowCoverageTrace([
      { direction: `asc`, offset: 0, limit: 4 },
      ...Array.from(
        { length: 20 },
        (): WindowRequest => ({ direction: `asc`, offset: 1, limit: 2 }),
      ),
    ])
  })

  it(`reuses an unlimited load across local orderings`, () => {
    runWindowCoverageTrace([
      {
        orderField: `none`,
        direction: `asc`,
        offset: 0,
        limit: undefined,
      },
      {
        where: { kind: `range`, operator: `gt`, value: 0 },
        orderField: `score`,
        direction: `desc`,
        nulls: `first`,
        stringSort: `locale`,
        offset: 0,
        limit: undefined,
      },
    ])
  })

  it.each([
    [
      `where`,
      {
        where: { kind: `eq`, value: 2 },
        orderField: `rank`,
        direction: `asc`,
        nulls: `last`,
        stringSort: `lexical`,
        offset: 0,
        limit: 2,
      },
    ],
    [
      `order expression`,
      {
        where: { kind: `eq`, value: 1 },
        orderField: `score`,
        direction: `asc`,
        nulls: `last`,
        stringSort: `lexical`,
        offset: 0,
        limit: 2,
      },
    ],
    [
      `null placement`,
      {
        where: { kind: `eq`, value: 1 },
        orderField: `rank`,
        direction: `asc`,
        nulls: `first`,
        stringSort: `lexical`,
        offset: 0,
        limit: 2,
      },
    ],
    [
      `string ordering`,
      {
        where: { kind: `eq`, value: 1 },
        orderField: `rank`,
        direction: `asc`,
        nulls: `last`,
        stringSort: `locale`,
        offset: 0,
        limit: 2,
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, WindowRequest]>)(
    `does not reuse window coverage across a different %s`,
    (_name, changedRequest) => {
      const baseRequest: WindowRequest = {
        where: { kind: `eq`, value: 1 },
        orderField: `rank`,
        direction: `asc`,
        nulls: `last`,
        stringSort: `lexical`,
        offset: 0,
        limit: 2,
      }
      expect(() =>
        runWindowCoverageTrace(
          [baseRequest, changedRequest],
          createWindowKeyBlindSubject,
        ),
      ).toThrow()
    },
  )

  it.each([
    [
      `null placement`,
      { nulls: `first`, stringSort: `lexical` },
      { nulls: `last`, stringSort: `lexical` },
    ],
    [
      `string ordering`,
      { nulls: `first`, stringSort: `lexical` },
      { nulls: `first`, stringSort: `locale` },
    ],
  ] as const)(
    `discovered trace: a different %s starts a distinct window load`,
    async (_name, firstOptions, secondOptions) => {
      const createRequest = (
        compareOptions: typeof firstOptions | typeof secondOptions,
      ): WindowRequest => ({
        direction: `asc`,
        orderField: `rank`,
        offset: 0,
        limit: 1,
        ...compareOptions,
      })
      await expectAssertionFailure(
        () =>
          Promise.resolve().then(() => {
            try {
              expect(
                countWindowLoads([
                  createRequest(firstOptions),
                  createRequest(secondOptions),
                ]),
              ).toBe(2)
            } catch (error) {
              throw new TraceAssertionError(0, error)
            }
          }),
        {
          checkpoint: 0,
          classify: ({ actual, expected }) => actual === 1 && expected === 2,
        },
      )()
    },
  )

  it(`rejects async transport work after coverage settles`, async () => {
    await expect(
      runAsyncScenario(
        {
          first: [1],
          second: [1],
          firstOutcome: `resolve`,
          secondOutcome: `resolve`,
          deliveryOrder: `forward`,
          resetBeforeSettlement: false,
        },
        createRefetchAfterSettlementSubject,
      ),
    ).rejects.toThrow()
  })

  it(`discovered trace: settled predicate regions cover their union`, async () => {
    await expectAssertionFailure(runAsyncScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) => actual === true && expected === false,
    })({
      first: [0],
      second: [1],
      firstOutcome: `resolve`,
      secondOutcome: `resolve`,
      deliveryOrder: `forward`,
      resetBeforeSettlement: false,
    })
  })

  fcTest.prop([requestTraceArbitrary], { numRuns: runs, seed: 1657 })(
    `matches finite-domain coverage for a fixed seed`,
    runCoverageTraceWithKnownFailures,
  )

  fcTest.prop([requestTraceArbitrary], randomParameters)(
    `matches finite-domain coverage for a random or replayed seed`,
    runCoverageTraceWithKnownFailures,
  )

  fcTest.prop([asyncScenarioArbitrary], { numRuns: runs, seed: 1658 })(
    `settles, retries, and resets in-flight set requests for a fixed seed`,
    runAsyncScenarioWithKnownFailures,
  )

  fcTest.prop([asyncScenarioArbitrary], randomParameters)(
    `settles, retries, and resets in-flight set requests for a random or replayed seed`,
    runAsyncScenarioWithKnownFailures,
  )

  fcTest.prop([concurrentAsyncScenarioArbitrary], {
    numRuns: runs,
    seed: 1661,
  })(
    `deduplicates three or more concurrent requests for a fixed seed`,
    runConcurrentAsyncScenario,
  )

  fcTest.prop([concurrentAsyncScenarioArbitrary], randomParameters)(
    `deduplicates three or more concurrent requests for a random or replayed seed`,
    runConcurrentAsyncScenario,
  )

  fcTest.prop([windowTraceArbitrary], { numRuns: runs, seed: 1659 })(
    `never treats uncovered ordered windows as loaded for a fixed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([windowTraceArbitrary], randomParameters)(
    `never treats uncovered ordered windows as loaded for a random or replayed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([distinctWindowWherePairArbitrary], {
    numRuns: runs,
    seed: 1662,
  })(
    `keeps distinct limited-window predicates separate for a fixed seed`,
    expectDistinctWhereStartsDistinctLimitedWindowLoads,
  )

  fcTest.prop([distinctWindowWherePairArbitrary], randomParameters)(
    `keeps distinct limited-window predicates separate for a random or replayed seed`,
    expectDistinctWhereStartsDistinctLimitedWindowLoads,
  )

  it(
    `an in-flight deduplicated waiter rejects without an unhandled branch`,
    expectAssertionFailure(expectDeduplicatedWaiterHandlesRejection, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        typeof actual === `object` &&
        actual !== null &&
        `branchCount` in actual &&
        actual.branchCount === 1 &&
        `statuses` in actual &&
        Array.isArray(actual.statuses) &&
        actual.statuses.join(`,`) === `rejected` &&
        typeof expected === `object` &&
        expected !== null &&
        `branchCount` in expected &&
        expected.branchCount === 1 &&
        `statuses` in expected &&
        Array.isArray(expected.statuses) &&
        expected.statuses.join(`,`) === `fulfilled`,
    }),
  )

  it(`applies loaded rows when no mutation is persisting`, async () => {
    await expectPersistingLoadIsApplied(false)
  })

  it(`applies loaded rows before resolving readiness behind a persisting mutation`, async () => {
    await expectAssertionFailure(expectPersistingLoadIsApplied, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        Array.isArray(actual) &&
        actual.length === 0 &&
        Array.isArray(expected) &&
        expected.join(`,`) === `r1,r2`,
    })(true)
  })

  it(`publishes synced source rows while a derived mutation persists`, async () => {
    await expectAssertionFailure(expectDerivedSyncDuringOptimisticMutation, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        Array.isArray(actual) &&
        actual.join(`,`) === `optimistic` &&
        Array.isArray(expected) &&
        expected.join(`,`) === `optimistic,synced`,
    })()
  })

  it(
    `discovered trace: adjacent ordered windows do not cover their combined window`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countWindowLoads([
              { direction: `asc`, offset: 0, limit: 2 },
              { direction: `asc`, offset: 2, limit: 2 },
              { direction: `asc`, offset: 0, limit: 4 },
            ]),
          ).toBe(2)
        }),
      { message: /expected 3 to be 2/ },
    ),
  )

  it(
    `discovered trace: complementary ranges redundantly reload an all-data request`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countLoads([
              { kind: `range`, operator: `gt`, value: 0 },
              { kind: `range`, operator: `lte`, value: 0 },
              { kind: `all` },
            ]),
          ).toBe(2)
        }),
      { message: /expected 3 to be 2/ },
    ),
  )

  it(
    `discovered trace: a range plus boundary point redundantly reloads a covered set`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countLoads([
              { kind: `range`, operator: `gt`, value: 0 },
              { kind: `eq`, value: 0 },
              { kind: `in`, values: [0, 1] },
            ]),
          ).toBe(2)
        }),
      { message: /expected 3 to be 2/ },
    ),
  )
})
