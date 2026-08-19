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

type AsyncScenario = {
  first: ReadonlyArray<number>
  second: ReadonlyArray<number>
  firstOutcome: `resolve` | `reject`
  secondOutcome: `resolve` | `reject`
  deliveryOrder: `forward` | `reverse`
  resetBeforeSettlement: boolean
}

type RangeOperator = Extract<PredicateSpec, { kind: `range` }>[`operator`]

type WindowRequest = {
  direction: `asc` | `desc`
  offset: number
  limit: number
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
}

type CoverageSubjectFactory = (
  recordLoad: (options: LoadSubsetOptions) => true,
) => CoverageSubject

class CoveredDemandRefetchedError extends Error {
  constructor(
    readonly checkpoint: number,
    readonly requested: ReadonlySet<number>,
    readonly loadedRegions: ReadonlyArray<ReadonlySet<number>>,
  ) {
    super(`Covered demand refetched at checkpoint ${checkpoint}`)
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

const predicateSpecArbitrary: fc.Arbitrary<PredicateSpec> = fc.oneof(
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

const requestTraceArbitrary = fc.array(predicateSpecArbitrary, {
  minLength: 1,
  maxLength: 20,
})

const inValuesArbitrary = fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
  minLength: 0,
  maxLength: 7,
})

// A rejected request with an in-flight deduplicated waiter currently creates a
// detached rejected promise inside DeduplicatedLoadSubset. Keep that discovered
// defect out of this green settlement corpus; it is pinned separately below.
const asyncScenarioArbitrary: fc.Arbitrary<AsyncScenario> = fc
  .record({
    first: inValuesArbitrary,
    second: inValuesArbitrary,
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

const windowRequestArbitrary: fc.Arbitrary<WindowRequest> = fc.record({
  direction: fc.constantFrom(`asc`, `desc`),
  offset: fc.integer({ min: 0, max: 6 }),
  limit: fc.integer({ min: 0, max: 6 }),
})

const windowTraceArbitrary = fc.array(windowRequestArbitrary, {
  minLength: 1,
  maxLength: 20,
})

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
  }
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

function runCoverageTrace(
  trace: ReadonlyArray<PredicateSpec>,
  createSubject = createDeduplicatedCoverageSubject,
): void {
  const covered = new Set<number>()
  const loadedRegions: Array<Set<number>> = []
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
        )
      }
      expectSetEqual(difference(missing, loaded), new Set())
      for (const value of loaded) covered.add(value)
      loadedRegions.push(loaded)
    }

    expectSetEqual(difference(requested, covered), new Set())
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
      (error.requested.size === 0 || error.loadedRegions.length > 1)
    ) {
      return
    }
    throw error
  }
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
  return {
    offset: request.offset,
    limit: request.limit,
    orderBy: [
      {
        expression: rankRef,
        compareOptions: {
          direction: request.direction,
          nulls: `last`,
          stringSort: `lexical`,
        },
      },
    ],
  }
}

function windowPositions(request: WindowRequest): Set<number> {
  return new Set(
    Array.from({ length: request.limit }, (_, index) => request.offset + index),
  )
}

function runWindowCoverageTrace(
  trace: ReadonlyArray<WindowRequest>,
  createSubject = createDeduplicatedCoverageSubject,
): void {
  const coveredByOrder = new Map<`asc` | `desc`, Set<number>>([
    [`asc`, new Set()],
    [`desc`, new Set()],
  ])
  const loadedRegionsByOrder = new Map<`asc` | `desc`, Array<Set<number>>>([
    [`asc`, []],
    [`desc`, []],
  ])
  const loads: Array<LoadSubsetOptions> = []
  const subject = createSubject((options) => {
    loads.push(options)
    return true
  })

  for (const [checkpoint, request] of trace.entries()) {
    const requested = windowPositions(request)
    const covered = coveredByOrder.get(request.direction)!
    const loadedRegions = loadedRegionsByOrder.get(request.direction)!
    const missing = difference(requested, covered)
    const callsBefore = loads.length

    subject.loadSubset(toWindowOptions(request))

    expect(loads.length - callsBefore).toBeLessThanOrEqual(1)
    if (loads.length === callsBefore) {
      expectSetEqual(missing, new Set())
    } else {
      const loaded = loads.at(-1)!
      expect(loaded.offset ?? 0).toBe(request.offset)
      expect(loaded.limit).toBe(request.limit)
      expect(loaded.orderBy?.[0]?.compareOptions.direction).toBe(
        request.direction,
      )
      if (missing.size === 0) {
        throw new CoveredDemandRefetchedError(
          checkpoint,
          requested,
          loadedRegions.map((region) => new Set(region)),
        )
      }
      for (const position of requested) covered.add(position)
      loadedRegions.push(requested)
    }
    expectSetEqual(difference(requested, covered), new Set())
  }
}

function runWindowCoverageTraceWithKnownFailures(
  trace: ReadonlyArray<WindowRequest>,
): void {
  try {
    runWindowCoverageTrace(trace)
  } catch (error) {
    if (
      error instanceof CoveredDemandRefetchedError &&
      (error.requested.size === 0 || error.loadedRegions.length > 1)
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

async function runAsyncScenario(scenario: AsyncScenario): Promise<void> {
  const requests: Array<{
    options: LoadSubsetOptions
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: (options) => {
      const deferred = createDeferred<void>()
      // The source promise is intentionally rejectable. Observe it directly as
      // well as through the dedupe wrapper so Vitest never mistakes a generated
      // transport rejection for an unhandled test error.
      void deferred.promise.catch(() => undefined)
      requests.push({ options, deferred })
      return deferred.promise
    },
  })

  const firstResult = dedupe.loadSubset({
    where: toWhere({ kind: `in`, values: scenario.first }),
  })
  const secondResult = dedupe.loadSubset({
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

  if (scenario.resetBeforeSettlement) dedupe.reset()

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
  const retry = dedupe.loadSubset({
    where: toWhere({ kind: `in`, values: scenario.second }),
  })
  const retryWasCovered = isSubset(secondSet, successfullyCovered)
  if (retry === true) {
    expect(retryWasCovered).toBe(true)
    expect(retry).toBe(true)
    expect(requests).toHaveLength(callsBeforeRetry)
  } else {
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

async function captureUnhandledRejections(
  run: () => Promise<void>,
): Promise<Array<unknown>> {
  const vitestHandler = process
    .listeners(`unhandledRejection`)
    .find((listener) => listener.name === `vitestUnhandledRejectionHandler`)
  const reasons: Array<unknown> = []
  const capture = (reason: unknown) => reasons.push(reason)

  if (vitestHandler) process.removeListener(`unhandledRejection`, vitestHandler)
  process.on(`unhandledRejection`, capture)
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return reasons
  } finally {
    process.removeListener(`unhandledRejection`, capture)
    if (vitestHandler) process.on(`unhandledRejection`, vitestHandler)
  }
}

async function expectDeduplicatedWaiterHandlesRejection(): Promise<void> {
  const deferred = createDeferred<void>()
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => deferred.promise,
  })

  const unhandled = await captureUnhandledRejections(async () => {
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
    deferred.reject(new Error(`transport failed`))
    expect((await callerOutcomes).map(({ status }) => status)).toEqual([
      `rejected`,
      `rejected`,
    ])
  })

  try {
    expect(unhandled).toEqual([])
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
    runAsyncScenario,
  )

  fcTest.prop([asyncScenarioArbitrary], randomParameters)(
    `settles, retries, and resets in-flight set requests for a random or replayed seed`,
    runAsyncScenario,
  )

  fcTest.prop([windowTraceArbitrary], { numRuns: runs, seed: 1659 })(
    `never treats uncovered ordered windows as loaded for a fixed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  fcTest.prop([windowTraceArbitrary], randomParameters)(
    `never treats uncovered ordered windows as loaded for a random or replayed seed`,
    runWindowCoverageTraceWithKnownFailures,
  )

  it(
    `an in-flight deduplicated waiter rejects without an unhandled branch`,
    expectAssertionFailure(expectDeduplicatedWaiterHandlesRejection, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        Array.isArray(actual) &&
        actual.length === 1 &&
        actual[0] instanceof Error &&
        actual[0].message === `transport failed` &&
        Array.isArray(expected) &&
        expected.length === 0,
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
