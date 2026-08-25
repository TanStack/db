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
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { TraceAssertionError } from '../trace-runner.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type {
  LoadSubsetFn,
  LoadSubsetOptions,
  LoadSubsetResult,
  SyncAppliedReceipt,
} from '../../src/types.js'

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

type ResultWrapperMode = `direct` | `await` | `rebuild`

type RejectedWaiterScenario = {
  covering: ReadonlyArray<number>
  covered: ReadonlyArray<number>
}

type RangeOperator = Extract<PredicateSpec, { kind: `range` }>[`operator`]

type WindowRequest = {
  where?: PredicateSpec
  orderField?: `none` | `rank` | `score`
  direction: `asc` | `desc`
  nulls?: `first` | `last`
  stringSort?: `lexical` | `locale`
  cursorBoundary?: number
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
  loadSubset: LoadSubsetFn
  reset?: () => void
}

type CoverageSubjectFactory = (recordLoad: LoadSubsetFn) => CoverageSubject

function requirePendingAppliedReceipt<T>(
  receipt: true | Promise<T>,
): Promise<T> {
  if (receipt === true) {
    throw new Error(`Expected an asynchronous subset load`)
  }
  return receipt
}

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

function booleanPredicateSpecArbitrary(
  operand: fc.Arbitrary<PredicateSpec>,
): fc.Arbitrary<PredicateSpec> {
  return fc.oneof(
    fc.record({
      kind: fc.constantFrom(`and` as const, `or` as const),
      operands: fc.tuple(operand, operand),
    }),
    operand.map((nested) => ({ kind: `not` as const, operand: nested })),
  )
}

const shallowPredicateSpecArbitrary = fc.oneof(
  atomicPredicateSpecArbitrary,
  booleanPredicateSpecArbitrary(atomicPredicateSpecArbitrary),
)

const predicateSpecArbitrary: fc.Arbitrary<PredicateSpec> = fc.oneof(
  { weight: 8, arbitrary: atomicPredicateSpecArbitrary },
  { weight: 2, arbitrary: shallowPredicateSpecArbitrary },
  {
    weight: 1,
    arbitrary: booleanPredicateSpecArbitrary(shallowPredicateSpecArbitrary),
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

const asyncScenarioArbitrary: fc.Arbitrary<AsyncScenario> = fc.record({
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

const concurrentAsyncScenarioArbitrary: fc.Arbitrary<ConcurrentAsyncScenario> =
  fc.record({
    requestedValues: fc.array(nonEmptyInValuesArbitrary, {
      minLength: 3,
      maxLength: 5,
    }),
    deliveryOrder: fc.constantFrom(`forward`, `reverse`),
  })

const resultWrapperModeArbitrary = fc.constantFrom<ResultWrapperMode>(
  `direct`,
  `await`,
  `rebuild`,
)

const rejectedWaiterScenarioArbitrary: fc.Arbitrary<RejectedWaiterScenario> =
  nonEmptyInValuesArbitrary.chain((covering) =>
    fc
      .subarray(covering, { minLength: 1 })
      .map((covered) => ({ covering, covered })),
  )

const windowRequestArbitrary: fc.Arbitrary<Omit<WindowRequest, `where`>> =
  fc.record({
    orderField: fc.constantFrom<NonNullable<WindowRequest[`orderField`]>>(
      `none`,
      `rank`,
      `score`,
    ),
    direction: fc.constantFrom<WindowRequest[`direction`]>(`asc`, `desc`),
    nulls: fc.constantFrom<NonNullable<WindowRequest[`nulls`]>>(
      `first`,
      `last`,
    ),
    stringSort: fc.constantFrom<NonNullable<WindowRequest[`stringSort`]>>(
      `lexical`,
      `locale`,
    ),
    cursorBoundary: fc.option(fc.integer({ min: -3, max: 3 }), {
      nil: undefined,
    }),
    offset: fc.integer({ min: 0, max: 6 }),
    limit: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
  })

const finiteWindowRequestArbitrary: fc.Arbitrary<Omit<WindowRequest, `where`>> =
  fc.record({
    orderField: fc.constantFrom(`none`, `rank`, `score`),
    direction: fc.constantFrom(`asc`, `desc`),
    nulls: fc.constantFrom(`first`, `last`),
    stringSort: fc.constantFrom(`lexical`, `locale`),
    cursorBoundary: fc.option(fc.integer({ min: -3, max: 3 }), {
      nil: undefined,
    }),
    offset: fc.integer({ min: 0, max: 6 }),
    limit: fc.integer({ min: 0, max: 6 }),
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
  .filter(isDistinctNonEmptyWindowWherePair)

function isDistinctNonEmptyWindowWherePair([first, second]: readonly [
  PredicateSpec,
  PredicateSpec,
]): boolean {
  const firstValues = matchingValues(toWhere(first))
  const secondValues = matchingValues(toWhere(second))
  return (
    firstValues.size > 0 &&
    secondValues.size > 0 &&
    (!isSubset(firstValues, secondValues) ||
      !isSubset(secondValues, firstValues))
  )
}

const changingWhereWindowTraceArbitrary = fc
  .record({
    wherePair: distinctWindowWherePairArbitrary,
    first: finiteWindowRequestArbitrary,
    second: finiteWindowRequestArbitrary,
    rest: fc.array(fc.tuple(fc.boolean(), finiteWindowRequestArbitrary), {
      maxLength: 18,
    }),
  })
  .map(({ wherePair, first, second, rest }) => [
    { ...first, where: wherePair[0] },
    { ...second, where: wherePair[1] },
    ...rest.map(([useSecond, request]) => ({
      ...request,
      where: wherePair[useSecond ? 1 : 0],
    })),
  ])

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

function matchingValues(
  where: BasicExpression<boolean> | undefined,
): Set<number> {
  return new Set(
    valueDomain.filter(
      (score) =>
        where === undefined ||
        evaluateReferenceExpression(where, { score }) === true,
    ),
  )
}

function difference(left: ReadonlySet<number>, right: ReadonlySet<number>) {
  return new Set([...left].filter((value) => !right.has(value)))
}

function isSubset(left: ReadonlySet<number>, right: ReadonlySet<number>) {
  return [...left].every((value) => right.has(value))
}

function unionSets(sets: ReadonlyArray<ReadonlySet<number>>): Set<number> {
  return new Set(sets.flatMap((set) => [...set]))
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
  }
}

function runCoverageTraceWithKnownFailures(
  trace: ReadonlyArray<PredicateSpec>,
): void {
  try {
    runCoverageTrace(trace)
  } catch (error) {
    if (
      error instanceof CoveredDemandRefetchedError &&
      (isKnownUnionCompositionRefetch(error) ||
        isKnownComposedRegionRefetch(error))
    ) {
      return
    }
    throw error
  }
}

function isKnownComposedRegionRefetch(
  error: CoveredDemandRefetchedError,
): boolean {
  if (error.requested.size === 0 || error.loadedRegions.length <= 1) {
    return false
  }

  return error.loadedRegions.some((region) => isSubset(error.requested, region))
}

function isKnownUnionCompositionRefetch(
  error: CoveredDemandRefetchedError,
): boolean {
  if (error.requested.size === 0) return true
  // The error can only be built after the independent model proves the demand
  // is already covered. This classifier is only for coverage formed by
  // composing several regions; a request covered by one region is a different
  // defect and must not enter this waiver.
  if (error.loadedRegions.length > 1) {
    const coveredByOneRegion = error.loadedRegions.some((region) =>
      isSubset(error.requested, region),
    )
    return (
      !coveredByOneRegion &&
      isSubset(error.requested, unionSets(error.loadedRegions))
    )
  }

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

function readDedupeTrackingState(dedupe: DeduplicatedLoadSubset): {
  unlimitedWhere: BasicExpression<boolean> | undefined
  limitedCalls: ReadonlyArray<LoadSubsetOptions>
  inflightCalls: ReadonlyArray<unknown>
} {
  return dedupe as unknown as {
    unlimitedWhere: BasicExpression<boolean> | undefined
    limitedCalls: ReadonlyArray<LoadSubsetOptions>
    inflightCalls: ReadonlyArray<unknown>
  }
}

function toWindowOptions(request: WindowRequest): LoadSubsetOptions {
  const orderField = request.orderField ?? `rank`
  const cursorRef = orderField === `score` ? scoreRef : rankRef
  return {
    where: request.where ? toWhere(request.where) : undefined,
    offset: request.offset,
    limit: request.limit,
    cursor:
      request.cursorBoundary === undefined
        ? undefined
        : {
            whereFrom: new Func(request.direction === `asc` ? `gt` : `lt`, [
              cursorRef,
              new Value(request.cursorBoundary),
            ]),
            whereCurrent: new Func(`eq`, [
              cursorRef,
              new Value(request.cursorBoundary),
            ]),
            lastKey: request.cursorBoundary,
          },
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

function hasNoWindowDemand(request: WindowRequest): boolean {
  return (
    request.limit === 0 ||
    matchingValues(toWindowOptions(request).where).size === 0
  )
}

function windowPositions(request: WindowRequest): Set<number> {
  if (hasNoWindowDemand(request)) return new Set()
  // The coverage oracle needs a finite universe. Generated finite windows end
  // at position 11, so 16 positions preserve every generated subset relation
  // while giving an omitted limit an authoritative "through the end" region.
  const length = request.limit ?? 16 - request.offset
  return new Set(Array.from({ length }, (_, index) => request.offset + index))
}

type WindowCoverageDescriptor = {
  request: WindowRequest
  whereFingerprint: string
  orderFingerprint: string | undefined
  cursorFingerprint: string | undefined
  matching: Set<number>
}

function describeWindowCoverage(
  request: WindowRequest,
): WindowCoverageDescriptor {
  const options = toWindowOptions(request)
  return {
    request,
    whereFingerprint: JSON.stringify(options.where),
    orderFingerprint: options.orderBy
      ? JSON.stringify(options.orderBy)
      : undefined,
    cursorFingerprint: options.cursor
      ? JSON.stringify(options.cursor)
      : undefined,
    matching: matchingValues(options.where),
  }
}

function describedWindowCovers(
  requested: WindowCoverageDescriptor,
  loaded: WindowCoverageDescriptor,
): boolean {
  if (
    loaded.request.limit === undefined &&
    loaded.request.offset === 0 &&
    loaded.cursorFingerprint === undefined &&
    isSubset(requested.matching, loaded.matching)
  ) {
    return true
  }
  if (requested.cursorFingerprint !== loaded.cursorFingerprint) {
    return false
  }
  if (requested.whereFingerprint !== loaded.whereFingerprint) return false
  if (requested.orderFingerprint === undefined) return true
  return requested.orderFingerprint === loaded.orderFingerprint
}

function loadedWindowCovers(
  requested: WindowRequest,
  loaded: WindowRequest,
): boolean {
  return describedWindowCovers(
    describeWindowCoverage(requested),
    describeWindowCoverage(loaded),
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

function isKnownOffsetTruncatedUnlimitedDeduplication(
  error: UncoveredWindowDeduplicatedError,
): boolean {
  const unlimitedLoads = error.loadedRegions.filter(
    ({ request }) => request.limit === undefined,
  )
  const offsetLoads = unlimitedLoads.filter(({ request }) => request.offset > 0)
  if (offsetLoads.length === 0) return false

  // The known defect stores unlimited predicate coverage without its offset or
  // ordering. Model that loss directly instead of replaying production dedupe.
  if (offsetLoads.some(({ request }) => request.where === undefined)) {
    return true
  }
  if (error.requested.where === undefined) return false

  const incorrectlyTrackedValues = unionSets(
    offsetLoads.map(({ request }) =>
      matchingValues(toWindowOptions(request).where),
    ),
  )
  return isSubset(
    matchingValues(toWindowOptions(error.requested).where),
    incorrectlyTrackedValues,
  )
}

function isKnownCoveredWindowRefetch(
  error: CoveredWindowRefetchedError,
): boolean {
  if (
    error.requestedPositions.size === 0 &&
    hasNoWindowDemand(error.requested)
  ) {
    return true
  }
  if (error.loadedRegions.length > 1) {
    if (
      !isSubset(
        error.requestedPositions,
        unionSets(error.loadedRegions.map(({ positions }) => positions)),
      )
    ) {
      return false
    }
    const coveredByOneRegion = error.loadedRegions.some(({ positions }) =>
      isSubset(error.requestedPositions, positions),
    )
    return !coveredByOneRegion
  }
  if (error.requested.where === undefined) return false

  return error.loadedRegions.some(
    ({ request: loaded, positions }) =>
      loadedWindowCovers(error.requested, loaded) &&
      isSubset(error.requestedPositions, positions),
  )
}

function isKnownIndividuallyCoveredWindowRefetch(
  error: CoveredWindowRefetchedError,
): boolean {
  if (error.loadedRegions.length <= 1) return false
  const coveredByOneRegion = error.loadedRegions.some(
    ({ request: loaded, positions }) =>
      loadedWindowCovers(error.requested, loaded) &&
      isSubset(error.requestedPositions, positions),
  )
  if (!coveredByOneRegion) return false

  const replay = [
    ...error.loadedRegions.map(({ request }) => request),
    error.requested,
  ]
  return countWindowLoads(replay) === replay.length
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
    coverage: WindowCoverageDescriptor
  }> = []
  const loads: Array<LoadSubsetOptions> = []
  const subject = createSubject((options) => {
    loads.push(options)
    return true
  })

  for (const [checkpoint, request] of trace.entries()) {
    const requested = windowPositions(request)
    const requestedCoverage = describeWindowCoverage(request)
    const compatibleRegions = loadedRegions.filter(({ coverage }) =>
      describedWindowCovers(requestedCoverage, coverage),
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
      loadedRegions.push({
        request: { ...request },
        positions: requested,
        coverage: requestedCoverage,
      })
    }
  }
}

function runWindowCoverageTraceWithKnownFailures(
  trace: ReadonlyArray<WindowRequest>,
): void {
  try {
    runWindowCoverageTrace(trace)
  } catch (error) {
    if (
      error instanceof UncoveredWindowDeduplicatedError &&
      (isKnownCompareOptionsDeduplication(error) ||
        isKnownUnlimitedOffsetDeduplication(error) ||
        isKnownOffsetTruncatedUnlimitedDeduplication(error))
    ) {
      return
    }
    if (
      error instanceof CoveredWindowRefetchedError &&
      (isKnownCoveredWindowRefetch(error) ||
        isKnownIndividuallyCoveredWindowRefetch(error))
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

function predicateDepth(predicate: PredicateSpec): number {
  if (predicate.kind === `and` || predicate.kind === `or`) {
    return 1 + Math.max(...predicate.operands.map(predicateDepth))
  }
  if (predicate.kind === `not`) return 1 + predicateDepth(predicate.operand)
  return 1
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
  expect(firstResult === secondResult).toBe(
    secondCoveredByFirst && setsEqual(secondSet, firstSet),
  )

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
  wrapperMode: ResultWrapperMode = `direct`,
): Promise<void> {
  const transports: Array<{
    values: Set<number>
    deferred: ReturnType<typeof createDeferred<LoadSubsetResult>>
  }> = []
  const deduplicated = createDeduplicatedCoverageSubject((options) => {
    const deferred = createDeferred<LoadSubsetResult>()
    transports.push({ values: matchingValues(options.where), deferred })
    return deferred.promise
  })
  const subject = wrapLoadSubsetResult(deduplicated, wrapperMode)
  const callerResults: Array<Promise<void | LoadSubsetResult>> = []
  const callerHasExactAuthority: Array<boolean> = []

  for (const values of scenario.requestedValues) {
    const requested = new Set(values)
    const coveringIndex = transports.findIndex(({ values: loaded }) =>
      isSubset(requested, loaded),
    )
    callerHasExactAuthority.push(
      coveringIndex === -1 ||
        setsEqual(requested, transports[coveringIndex]!.values),
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
    } else {
      expect(transports).toHaveLength(transportCount)
    }
  }

  const delivery =
    scenario.deliveryOrder === `forward`
      ? transports
      : [...transports].reverse()
  for (const { deferred } of delivery) deferred.resolve({ hasMore: false })
  const results = await Promise.all(callerResults)
  for (const [index, result] of results.entries()) {
    expect(result?.hasMore).toBe(
      callerHasExactAuthority[index] ? false : undefined,
    )
  }
}

function wrapLoadSubsetResult(
  subject: CoverageSubject,
  mode: ResultWrapperMode,
): CoverageSubject {
  if (mode === `direct`) return subject

  return {
    loadSubset: async (options) => {
      const result = subject.loadSubset(options)
      if (result === true) return undefined
      const sourceResult = await result
      if (mode === `rebuild` && sourceResult !== undefined) {
        return { hasMore: sourceResult.hasMore }
      }
      return sourceResult
    },
    reset: subject.reset,
  }
}

function setsEqual(left: ReadonlySet<number>, right: ReadonlySet<number>) {
  return left.size === right.size && isSubset(left, right)
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

const { multiplier, replaySeed } = readOracleRunConfig()
const coverageScenarioRuns = 40 * multiplier
const coverageRandomParameters = oracleRandomParameters(
  coverageScenarioRuns,
  replaySeed,
)

let collectionSequence = 0

async function expectPersistingLoadIsApplied(
  persisting: boolean,
  delivery: `synchronous` | `asynchronous` = `synchronous`,
  transactionStart: `during-load` | `before-load` = `during-load`,
) {
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
        if (transactionStart === `before-load`) begin()
        markReady()
        return {
          loadSubset: () => {
            loadCalls += 1
            const applyRows = () => {
              if (transactionStart === `during-load`) begin()
              for (const row of rows) {
                write({ type: `insert`, value: { ...row } })
              }
              return commit()
            }
            if (delivery === `synchronous`) {
              return applyRows()
            }
            return Promise.resolve().then(async () => {
              const applied = applyRows()
              if (applied !== true) await applied
            })
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
    const ready = live.toArrayWhenReady()
    if (persisting) {
      let settled = false
      void ready.then(() => {
        settled = true
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(settled).toBe(false)
      expect(source.get(`r1`)).toBeUndefined()
      expect(source.get(`r2`)).toBeUndefined()

      persistence.resolve()
      await transaction.isPersisted.promise
    }

    const result = await ready
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
    await live.cleanup()
    await source.cleanup()
  }
}

async function expectAppliedReceiptTiming(
  gate: `free` | `parked`,
  delivery: `synchronous` | `asynchronous`,
): Promise<void> {
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-timing-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            const applyRow = () => {
              begin()
              write({
                type: `insert`,
                value: { id: `remote`, projectId: `p1` },
              })
              return commit()
            }

            return delivery === `synchronous`
              ? applyRow()
              : Promise.resolve().then(async () => {
                  const applied = applyRow()
                  if (applied !== true) await applied
                })
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  if (gate === `parked`) {
    transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    expect(transaction.state).toBe(`persisting`)
  }

  const receipt = source._sync.loadSubset({})

  try {
    if (gate === `free` && delivery === `synchronous`) {
      expect(receipt).toBe(true)
      expect(source.get(`remote`)).toEqual(
        expect.objectContaining({ id: `remote`, projectId: `p1` }),
      )
      return
    }

    const pending = requirePendingAppliedReceipt(receipt)
    let settled = false
    let visibleWhenSettled = false
    void pending.then(() => {
      settled = true
      visibleWhenSettled = source.get(`remote`)?.id === `remote`
    })

    expect(settled).toBe(false)
    expect(source.get(`remote`)).toBeUndefined()
    await Promise.resolve()
    await Promise.resolve()

    if (gate === `parked`) {
      expect(settled).toBe(false)
      expect(source.get(`remote`)).toBeUndefined()
      persistence.resolve()
      await transaction.isPersisted.promise
    }

    await pending
    expect(settled).toBe(true)
    expect(visibleWhenSettled).toBe(true)
    expect(source.get(`remote`)).toEqual(
      expect.objectContaining({ id: `remote`, projectId: `p1` }),
    )
  } finally {
    persistence.resolve()
    if (gate === `parked`) {
      await transaction.isPersisted.promise.catch(() => undefined)
    }
    await source.cleanup()
  }
}

async function expectAppliedLoadDoesNotFlushEarlierParkedSync() {
  const rows: Array<PersistedLoadRow> = [
    { id: `r1`, projectId: `p1` },
    { id: `r2`, projectId: `p1` },
  ]
  let publishUnrelated!: () => void
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-order-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        markReady()
        return {
          loadSubset: () => {
            begin()
            for (const row of rows) {
              write({ type: `insert`, value: { ...row } })
            }
            return commit()
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
  expect(transaction.state).toBe(`persisting`)
  publishUnrelated()

  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
  )

  try {
    const ready = live.toArrayWhenReady()
    let settled = false
    void ready.then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()

    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(ready).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `r1` }),
        expect.objectContaining({ id: `r2` }),
      ]),
    )
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await live.cleanup()
    await source.cleanup()
  }
}

async function expectCoverageWaitsForAppliedRows() {
  let publishUnrelated!: () => void
  let transportCalls = 0
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-coverage-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        const deduplicated = new DeduplicatedLoadSubset({
          loadSubset: () => {
            transportCalls += 1
            begin()
            write({
              type: `insert`,
              value: { id: `r1`, projectId: `p1` },
            })
            return commit()
          },
        })
        markReady()
        return { loadSubset: deduplicated.loadSubset }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
  publishUnrelated()

  try {
    const first = source._sync.loadSubset({})
    expect(first).toBeInstanceOf(Promise)
    await Promise.resolve()
    await Promise.resolve()

    const concurrent = source._sync.loadSubset({})
    expect(concurrent).toBeInstanceOf(Promise)
    expect(transportCalls).toBe(1)
    expect(source.get(`r1`)).toBeUndefined()

    persistence.resolve()
    await transaction.isPersisted.promise
    await Promise.all([first, concurrent])
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
    expect(source._sync.loadSubset({})).toBe(true)
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectConcurrentStreamCommitStaysParked() {
  let publishUnrelated!: () => void
  let publishSubset!: () => void
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-concurrent-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        markReady()
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              publishSubset = () => {
                begin()
                write({
                  type: `insert`,
                  value: { id: `r1`, projectId: `p1` },
                })
                const applied = commit()
                if (applied === true) {
                  resolve()
                } else {
                  void applied.then(resolve)
                }
              }
            }),
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))

  const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
  publishUnrelated()
  publishSubset()

  try {
    let settled = false
    void load.then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()
    expect(source.get(`r1`)).toBeUndefined()
    persistence.resolve()
    await transaction.isPersisted.promise
    await load
    expect(source.get(`unrelated`)).toEqual(
      expect.objectContaining({ id: `unrelated`, projectId: `p2` }),
    )
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectLaterImmediateCommitSettlesAppliedSubset() {
  let publishLater!: () => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-priority-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: { id: `initial`, projectId: `p0` },
        })
        void commit()
        publishLater = () => {
          begin({ immediate: true })
          write({
            type: `insert`,
            value: { id: `later`, projectId: `p2` },
          })
          return commit()
        }
        markReady()
        return {
          loadSubset: () => {
            begin()
            write({
              type: `insert`,
              value: { id: `subset`, projectId: `p1` },
            })
            return commit()
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `p3` }))

  const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
  const later = publishLater()

  try {
    let loadSettled = false
    let subsetVisibleWhenSettled = false
    void load.then(() => {
      loadSettled = true
      subsetVisibleWhenSettled = source.get(`subset`)?.id === `subset`
    })
    await later
    await load

    expect(loadSettled).toBe(true)
    expect(subsetVisibleWhenSettled).toBe(true)
    expect(source.get(`subset`)).toEqual(
      expect.objectContaining({ id: `subset` }),
    )
    expect(source.get(`later`)).toEqual(
      expect.objectContaining({ id: `later` }),
    )
    expect(source.get(`initial`)).toEqual(
      expect.objectContaining({ id: `initial` }),
    )

    persistence.resolve()
    await transaction.isPersisted.promise
    await Promise.all([load, later])

    expect(source.get(`subset`)).toEqual(
      expect.objectContaining({ id: `subset` }),
    )
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectAbortedReceiptDoesNotPublishCoverage(
  abortPhase: `before-commit` | `while-parked`,
) {
  let transportCalls = 0
  const committed = createDeferred<void>()
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: async ({ signal }) => {
      transportCalls += 1
      if (abortPhase === `before-commit`) {
        // Give cancellation a chance to revoke this request before its
        // request-scoped rows enter the collection transaction.
        await Promise.resolve()
        if (signal?.aborted) {
          return
        }
      }
      begin()
      write({
        type: `insert`,
        value: { id: `row`, projectId: `p1` },
      })
      const applied = commit(signal)
      committed.resolve()
      if (applied !== true) await applied
    },
  })
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PersistedLoadRow }) => void
  let commit!: (signal?: AbortSignal) => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-abort-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return { loadSubset: deduplicated.loadSubset }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
  const controller = new AbortController()
  const first = requirePendingAppliedReceipt(
    source._sync.loadSubset({ signal: controller.signal }),
  )
  if (abortPhase === `while-parked`) {
    await committed.promise
  }
  controller.abort()

  try {
    persistence.resolve()
    await transaction.isPersisted.promise
    if (abortPhase === `while-parked`) {
      await expect(first).rejects.toMatchObject({ name: `AbortError` })
    } else {
      await first
    }
    expect(transportCalls).toBe(1)
    expect(source.get(`row`)).toBeUndefined()

    const retry = source._sync.loadSubset({})
    if (retry !== true) await retry
    expect(transportCalls).toBe(2)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectAbortDuringPublicationDoesNotCancelReceipt() {
  const controller = new AbortController()
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-publication-abort-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: ({ signal }) => {
            begin()
            write({
              type: `insert`,
              value: { id: `row`, projectId: `p1` },
            })
            return commit(signal)
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `pending` }))
  const subscription = source.subscribeChanges((changes) => {
    if (changes.some((change) => change.key === `row`)) {
      controller.abort()
    }
  })
  const load = requirePendingAppliedReceipt(
    source._sync.loadSubset({ signal: controller.signal }),
  )

  try {
    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(load).resolves.toMatchObject({ extent: `unknown` })
    expect(controller.signal.aborted).toBe(true)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } finally {
    subscription.unsubscribe()
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectCanceledReceiptReleasesOnlyItsSuppression() {
  let begin!: () => void
  let write!: (message: { type: `update`; value: PersistedLoadRow }) => void
  let commit!: (signal?: AbortSignal) => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-cancel-suppression-${collectionSequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `update`, value: { id: `first`, projectId: `old` } })
        write({ type: `update`, value: { id: `second`, projectId: `old` } })
        commit()
        params.markReady()
      },
    },
  })
  await source.preload()
  await Promise.resolve()
  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `pending` }))
  expect(transaction.state).toBe(`persisting`)
  try {
    begin()
    write({ type: `update`, value: { id: `first`, projectId: `new` } })
    const canceled = commit()
    const canceledTransaction = source._state.pendingSyncedTransactions.at(-1)!
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    begin()
    write({ type: `update`, value: { id: `second`, projectId: `new` } })
    expect(source._state.pendingSyncedTransactions).toHaveLength(2)

    source._state.capturePreSyncVisibleState()
    expect(source._state.recentlySyncedKeys).toEqual(
      new Set([`first`, `second`]),
    )

    source._state.cancelPendingSyncedTransaction(canceledTransaction)
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    expect(source._state.recentlySyncedKeys).toEqual(new Set([`second`]))
    expect(source._state.preSyncVisibleState.has(`first`)).toBe(false)
    expect(source._state.preSyncVisibleState.has(`second`)).toBe(true)
    if (canceled !== true) {
      await expect(canceled).rejects.toMatchObject({ name: `AbortError` })
    }
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectCleanupRejectsReceiptOnce() {
  let receipt!: Promise<void>
  let transportCalls = 0
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: () => {
      transportCalls += 1
      begin()
      write({
        type: `insert`,
        value: { id: `row`, projectId: `p1` },
      })
      const applied = commit()
      if (transportCalls === 1) {
        if (applied === true) {
          throw new Error(`Expected the subset transaction to remain parked`)
        }
        receipt = applied
      }
      return applied
    },
  })
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PersistedLoadRow }) => void
  let commit!: () => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-cleanup-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: deduplicated.loadSubset,
          cleanup: () => deduplicated.reset(),
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
  const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
  let settlements = 0
  void receipt.then(
    () => {
      settlements += 1
    },
    () => {
      settlements += 1
    },
  )

  await source.cleanup()
  await expect(load).rejects.toMatchObject({ name: `AbortError` })
  await expect(receipt).rejects.toMatchObject({ name: `AbortError` })
  expect(settlements).toBe(1)

  persistence.resolve()
  await transaction.isPersisted.promise.catch(() => undefined)
  await Promise.resolve()
  expect(settlements).toBe(1)

  // Restarting installs fresh sync controls. Reacquisition must both perform
  // transport work and publish its rows; stale callbacks cannot prove either.
  source.startSyncImmediate()
  const retry = source._sync.loadSubset({})
  if (retry !== true) await retry
  expect(transportCalls).toBe(2)
  expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))

  await source.cleanup()
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
    await derived.cleanup()
    await source.cleanup()
  }
}

async function expectDeduplicatedWaiterHandlesRejection(
  scenario: RejectedWaiterScenario,
): Promise<void> {
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
    where: toWhere({ kind: `in`, values: scenario.covering }),
  })
  const second = dedupe.loadSubset({
    where: toWhere({ kind: `in`, values: scenario.covered }),
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

function expectExactCountFailure(
  count: () => number,
  actual: number,
  expected: number,
): () => Promise<void> {
  return expectAssertionFailure(
    () =>
      Promise.resolve().then(() => {
        try {
          expect(count()).toBe(expected)
        } catch (error) {
          throw new TraceAssertionError(0, error)
        }
      }),
    {
      checkpoint: 0,
      classify: ({ actual: received, expected: wanted }) =>
        received === actual && wanted === expected,
    },
  )
}

describe(`loadSubset coverage oracle`, () => {
  it(`orders a missing reference path with null`, () => {
    const missing = new PropRef<number | null>([`missing`])

    expect(
      evaluateReferenceExpression(
        new Func(`lte`, [missing, new Value(null)]),
        {},
      ),
    ).toBe(true)
    expect(
      evaluateReferenceExpression(new Func(`lt`, [missing, new Value(0)]), {}),
    ).toBe(true)
  })

  it(`rejects one-region coverage from the union-composition classifier`, () => {
    expect(
      isKnownUnionCompositionRefetch(
        new CoveredDemandRefetchedError(
          2,
          new Set([1]),
          [new Set([1]), new Set([2])],
          JSON.stringify({ kind: `eq`, value: 1 }),
          [
            JSON.stringify({ kind: `eq`, value: 1 }),
            JSON.stringify({ kind: `eq`, value: 2 }),
          ],
        ),
      ),
    ).toBe(false)
  })

  it(`classifies a composed state that forgets one loaded region separately`, () => {
    const error = new CoveredDemandRefetchedError(
      2,
      new Set([2]),
      [new Set([0]), new Set([2])],
      JSON.stringify({ kind: `eq`, value: 2 }),
      [
        JSON.stringify({ kind: `in`, values: [0] }),
        JSON.stringify({ kind: `in`, values: [2] }),
      ],
    )

    expect(isKnownUnionCompositionRefetch(error)).toBe(false)
    expect(isKnownComposedRegionRefetch(error)).toBe(true)
  })

  it(`rejects an uncovered window from the union classifier`, () => {
    const request: WindowRequest = {
      direction: `asc`,
      offset: 2,
      limit: 1,
    }
    expect(
      isKnownCoveredWindowRefetch(
        new CoveredWindowRefetchedError(2, request, new Set([2]), [
          {
            request: { direction: `asc`, offset: 0, limit: 1 },
            positions: new Set([0]),
          },
          {
            request: { direction: `asc`, offset: 1, limit: 1 },
            positions: new Set([1]),
          },
        ]),
      ),
    ).toBe(false)
  })

  it(`generates window histories that change predicates`, () => {
    const traces = fc.sample(changingWhereWindowTraceArbitrary, {
      seed: 1750,
      numRuns: 100,
    })

    expect(
      traces.some(
        (trace) =>
          new Set(trace.map(({ where }) => JSON.stringify(where))).size > 1,
      ),
    ).toBe(true)
  })

  it(`generates nested boolean predicates`, () => {
    const predicates = fc.sample(predicateSpecArbitrary, {
      seed: 1751,
      numRuns: 500,
    })

    expect(predicates.some((predicate) => predicateDepth(predicate) >= 3)).toBe(
      true,
    )
  })

  it(`generates rejected requests shared by a covered waiter`, () => {
    const scenarios = fc.sample(asyncScenarioArbitrary, {
      seed: 1752,
      numRuns: 500,
    })

    expect(
      scenarios.some(
        (scenario) =>
          scenario.firstOutcome === `reject` &&
          scenario.second.every((value) => scenario.first.includes(value)),
      ),
    ).toBe(true)
  })

  it(`rejects unrelated offset loss from the truncated-unlimited classifier`, () => {
    expect(
      isKnownOffsetTruncatedUnlimitedDeduplication(
        new UncoveredWindowDeduplicatedError(
          1,
          {
            where: { kind: `eq`, value: 1 },
            direction: `asc`,
            offset: 0,
            limit: 1,
          },
          [
            {
              request: {
                where: { kind: `eq`, value: 2 },
                direction: `asc`,
                offset: 1,
                limit: undefined,
              },
              positions: new Set([1, 2]),
            },
          ],
        ),
      ),
    ).toBe(false)
  })

  it(`keeps empty predicates out of the distinct-window corpus`, () => {
    expect(
      isDistinctNonEmptyWindowWherePair([
        { kind: `in`, values: [] },
        { kind: `eq`, value: 0 },
      ]),
    ).toBe(false)
  })

  it(
    `discovered trace: an empty predicate issues no transport work`,
    expectExactCountFailure(
      () => countLoads([{ kind: `in`, values: [] }]),
      1,
      0,
    ),
  )

  it(
    `discovered trace: an empty ordered window issues no transport work`,
    expectExactCountFailure(
      () => countWindowLoads([{ direction: `asc`, offset: 0, limit: 0 }]),
      1,
      0,
    ),
  )

  it(
    `discovered trace: an empty filtered window issues no transport work`,
    expectExactCountFailure(
      () =>
        countWindowLoads([
          {
            where: { kind: `in`, values: [] },
            direction: `asc`,
            offset: 0,
            limit: 1,
          },
        ]),
      1,
      0,
    ),
  )

  it(
    `discovered trace: a contradictory filtered window issues no transport work`,
    expectExactCountFailure(
      () =>
        countWindowLoads([
          {
            where: {
              kind: `and`,
              operands: [
                { kind: `eq`, value: 0 },
                { kind: `eq`, value: 1 },
              ],
            },
            direction: `asc`,
            offset: 0,
            limit: 1,
          },
        ]),
      1,
      0,
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
    `discovered trace: an offset-truncated unlimited load does not cover another ordering`,
    expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect(
            countWindowLoads([
              {
                orderField: `rank`,
                direction: `asc`,
                offset: 1,
                limit: undefined,
              },
              {
                orderField: `score`,
                direction: `asc`,
                offset: 1,
                limit: 1,
              },
            ]),
          ).toBe(2)
        }),
      { message: /expected 1 to be 2/ },
    ),
  )

  it(
    `discovered trace: an offset-truncated unfiltered load does not cover a filtered request`,
    expectExactCountFailure(
      () =>
        countWindowLoads([
          {
            direction: `asc`,
            offset: 1,
            limit: undefined,
          },
          {
            where: { kind: `not`, operand: { kind: `eq`, value: 0 } },
            direction: `asc`,
            offset: 1,
            limit: undefined,
          },
        ]),
      1,
      2,
    ),
  )

  it(`discovered trace: an identical filtered window reuses its load`, () => {
    const request: WindowRequest = {
      where: { kind: `in`, values: [0] },
      orderField: `none`,
      direction: `asc`,
      offset: 0,
      limit: 1,
    }
    expect(countWindowLoads([request, request])).toBe(1)
  })

  it(`discovered trace: distinct cursor pages start distinct loads`, () => {
    const request: WindowRequest = {
      orderField: `rank`,
      direction: `asc`,
      offset: 0,
      limit: 2,
      cursorBoundary: 1,
    }

    runWindowCoverageTrace([
      request,
      { ...request, cursorBoundary: 2 },
      request,
    ])
  })

  it(`discovered trace: a cursor without a limit is not full coverage`, () => {
    const request: WindowRequest = {
      orderField: `rank`,
      direction: `asc`,
      offset: 0,
      limit: undefined,
      cursorBoundary: 1,
    }

    runWindowCoverageTrace([
      request,
      { ...request, cursorBoundary: 2 },
      { ...request, cursorBoundary: undefined },
    ])
  })

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

  it(`keeps tracking bounded across repeated covered demand`, () => {
    const dedupe = new DeduplicatedLoadSubset({ loadSubset: () => true })
    const request: LoadSubsetOptions = {
      where: toWhere({ kind: `range`, operator: `gte`, value: 0 }),
      offset: 0,
      limit: 4,
    }

    dedupe.loadSubset(request)
    for (let index = 0; index < 20; index++) dedupe.loadSubset(request)

    const state = readDedupeTrackingState(dedupe)
    expect(state.limitedCalls).toHaveLength(1)
    expect(state.inflightCalls).toHaveLength(0)
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

  it(
    `discovered trace: a composed predicate state forgets one loaded region`,
    expectExactCountFailure(
      () =>
        countLoads([
          { kind: `in`, values: [0] },
          { kind: `in`, values: [2] },
          { kind: `eq`, value: 2 },
        ]),
      3,
      2,
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
      runCoverageTrace(
        [predicate, predicate],
        createAlwaysLoadingCoverageSubject,
      ),
    ).toThrow()
  })

  it(`rejects repeated transport work for a covered compound predicate`, () => {
    const covering: PredicateSpec = {
      kind: `and`,
      operands: [
        { kind: `range`, operator: `gte`, value: 0 },
        { kind: `not`, operand: { kind: `eq`, value: 2 } },
      ],
    }
    const covered: PredicateSpec = {
      kind: `or`,
      operands: [
        { kind: `eq`, value: 1 },
        { kind: `eq`, value: 3 },
      ],
    }

    expect(() =>
      runCoverageTrace([covering, covered], createAlwaysLoadingCoverageSubject),
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

  it(`does not treat an offset-truncated unlimited load as complete under another ordering`, () => {
    expect(
      loadedWindowCovers(
        {
          orderField: `score`,
          direction: `asc`,
          offset: 1,
          limit: 1,
        },
        {
          orderField: `rank`,
          direction: `asc`,
          offset: 1,
          limit: undefined,
        },
      ),
    ).toBe(false)
  })

  it(`rejects redundant work for a window covered by one loaded region`, () => {
    const first: WindowRequest = {
      direction: `asc`,
      offset: 0,
      limit: 2,
    }
    expect(() =>
      runWindowCoverageTrace(
        [first, { direction: `asc`, offset: 2, limit: 2 }, first],
        createAlwaysLoadingCoverageSubject,
      ),
    ).toThrow()
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
    (_name, firstOptions, secondOptions) => {
      const createRequest = (
        compareOptions: typeof firstOptions | typeof secondOptions,
      ): WindowRequest => ({
        direction: `asc`,
        orderField: `rank`,
        offset: 0,
        limit: 1,
        ...compareOptions,
      })
      expect(
        countWindowLoads([
          createRequest(firstOptions),
          createRequest(secondOptions),
        ]),
      ).toBe(2)
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

  it.each([
    `direct`,
    `await`,
    `rebuild`,
  ] satisfies ReadonlyArray<ResultWrapperMode>)(
    `keeps caller-relative source extent through the %s result wrapper`,
    async (wrapperMode) => {
      await runConcurrentAsyncScenario(
        {
          requestedValues: [[1, 2], [1], [1, 2]],
          deliveryOrder: `forward`,
        },
        wrapperMode,
      )
    },
  )

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

  fcTest.prop([requestTraceArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1657,
  })(
    `matches finite-domain coverage for a fixed seed`,
    runCoverageTraceWithKnownFailures,
  )

  fcTest.prop([requestTraceArbitrary], coverageRandomParameters)(
    `matches finite-domain coverage for a random or replayed seed`,
    runCoverageTraceWithKnownFailures,
  )

  fcTest.prop([asyncScenarioArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1658,
  })(
    `settles, retries, and resets in-flight set requests for a fixed seed`,
    runAsyncScenarioWithKnownFailures,
  )

  fcTest.prop([asyncScenarioArbitrary], coverageRandomParameters)(
    `settles, retries, and resets in-flight set requests for a random or replayed seed`,
    runAsyncScenarioWithKnownFailures,
  )

  fcTest.prop([concurrentAsyncScenarioArbitrary, resultWrapperModeArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1661,
  })(
    `deduplicates three or more concurrent requests for a fixed seed`,
    runConcurrentAsyncScenario,
  )

  fcTest.prop(
    [concurrentAsyncScenarioArbitrary, resultWrapperModeArbitrary],
    coverageRandomParameters,
  )(
    `deduplicates three or more concurrent requests for a random or replayed seed`,
    runConcurrentAsyncScenario,
  )

  fcTest.prop([rejectedWaiterScenarioArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1665,
  })(
    `checks rejected requests observed by an in-flight waiter for a fixed seed`,
    expectDeduplicatedWaiterHandlesRejection,
  )

  fcTest.prop([rejectedWaiterScenarioArbitrary], coverageRandomParameters)(
    `checks rejected requests observed by an in-flight waiter for a random or replayed seed`,
    expectDeduplicatedWaiterHandlesRejection,
  )

  fcTest.prop([windowTraceArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1659,
  })(
    `never treats uncovered ordered windows as loaded for a fixed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([windowTraceArbitrary], coverageRandomParameters)(
    `never treats uncovered ordered windows as loaded for a random or replayed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([changingWhereWindowTraceArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1666,
  })(
    `keeps changing predicates distinct across window histories for a fixed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([changingWhereWindowTraceArbitrary], coverageRandomParameters)(
    `keeps changing predicates distinct across window histories for a random or replayed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([distinctWindowWherePairArbitrary], {
    numRuns: coverageScenarioRuns,
    seed: 1662,
  })(
    `keeps distinct limited-window predicates separate for a fixed seed`,
    expectDistinctWhereStartsDistinctLimitedWindowLoads,
  )

  fcTest.prop([distinctWindowWherePairArbitrary], coverageRandomParameters)(
    `keeps distinct limited-window predicates separate for a random or replayed seed`,
    expectDistinctWhereStartsDistinctLimitedWindowLoads,
  )

  it(`an in-flight deduplicated waiter rejects without an unhandled branch`, async () => {
    await expectDeduplicatedWaiterHandlesRejection({
      covering: [1, 2],
      covered: [1],
    })
  })

  it(`applies loaded rows when no mutation is persisting`, async () => {
    await expectPersistingLoadIsApplied(false)
  })

  it(`applies loaded rows before resolving readiness behind a persisting mutation`, async () => {
    await expectPersistingLoadIsApplied(true)
  })

  it(`applies asynchronously delivered rows before resolving readiness`, async () => {
    await expectPersistingLoadIsApplied(true, `asynchronous`)
  })

  it(`applies a transaction opened before its subset demand`, async () => {
    await expectPersistingLoadIsApplied(true, `synchronous`, `before-load`)
  })

  it.each([
    [`free`, `synchronous`],
    [`free`, `asynchronous`],
    [`parked`, `synchronous`],
    [`parked`, `asynchronous`],
  ] as const)(
    `preserves applied-receipt timing with a %s gate and %s delivery`,
    expectAppliedReceiptTiming,
  )

  it(`does not flush earlier parked sync work to apply a subset load`, async () => {
    await expectAppliedLoadDoesNotFlushEarlierParkedSync()
  })

  it(`publishes coverage only after its establishing rows apply`, async () => {
    await expectCoverageWaitsForAppliedRows()
  })

  it(`keeps an unrelated stream commit parked during a subset acquisition`, async () => {
    await expectConcurrentStreamCommitStaysParked()
  })

  it(`settles a subset receipt after a later immediate commit applies it`, async () => {
    await expectLaterImmediateCommitSettlesAppliedSubset()
  })

  it.each([`before-commit`, `while-parked`] as const)(
    `does not publish coverage when a parked receipt is aborted %s`,
    expectAbortedReceiptDoesNotPublishCoverage,
  )

  it(`ignores an abort raised after application starts publishing`, async () => {
    await expectAbortDuringPublicationDoesNotCancelReceipt()
  })

  it(`releases only a canceled receipt's event suppression`, async () => {
    await expectCanceledReceiptReleasesOnlyItsSuppression()
  })

  it(`rejects an abandoned receipt once without publishing coverage`, async () => {
    await expectCleanupRejectsReceiptOnce()
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

  it(`discovered trace: widening a window remembers an earlier covered window`, () => {
    const first: WindowRequest = {
      orderField: `none`,
      direction: `asc`,
      offset: 0,
      limit: 1,
      where: { kind: `in`, values: [0] },
    }
    expect(countWindowLoads([first, { ...first, limit: 2 }, first])).toBe(2)
  })

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
