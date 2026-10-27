import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createDeferred } from '../../src/deferred.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import {
  exactDemandAxisPairs,
  toLoadSubsetOptions,
} from './load-subset-support.js'
import type { ExactDemand } from './load-subset-support.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../src/types.js'

/**
 * # When are two loadSubset demands the same, and when do they share work?
 *
 * Exact demand identity includes predicate values, order terms and comparison
 * options, offset, limit, and cursor boundary. Equal demands share one physical
 * acquisition; distinct demands do not. Rejection reaches every waiter, then
 * leaves the demand retryable. `refetch` starts fresh work for the same request
 * data. Requests with separate abort signals cannot share in-flight work.
 *
 * The model is the demand-identity rule: a completed demand starts once, and
 * only identical in-flight demands share a promise. The checks run the
 * deduplicating loader over generated demand traces and compare each start
 * count and promise identity with that rule. The identity model uses an
 * independent SQL expression evaluator for nullish comparisons, and it does not
 * use the production fingerprint as the expected value.
 *
 * Authority: the exact-request contract in
 * `packages/db/src/query/live/ARCHITECTURE.md` (Demand grouping and ownership).
 * The plain-record fingerprint models equality of request data, not source
 * coverage or row ownership. This file owns runtime sharing and retry for equal
 * and distinct demands. `ir-stable-identity-oracle.test.ts` owns demand-key
 * construction. The applied-settlement and cancellation law, which needs real
 * transactions and sync receipts, is in `load-subset.test.ts`.
 */

type ConcurrentExactScenario = {
  trace: ReadonlyArray<ExactDemand>
  settlementOrder: `forward` | `reverse`
}

const exactDemandArbitrary: fc.Arbitrary<ExactDemand> = fc
  .record({
    values: fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
      minLength: 1,
      maxLength: 5,
    }),
    orderField: fc.constantFrom(`rank` as const, `score` as const),
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    nulls: fc.constantFrom(`first` as const, `last` as const),
    stringSort: fc.constantFrom(`lexical` as const, `locale` as const),
    offset: fc.integer({ min: 0, max: 4 }),
    limit: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
    cursorBoundary: fc.option(fc.integer({ min: -3, max: 3 }), {
      nil: undefined,
    }),
  })
  .map((demand) => ({
    ...demand,
    values: [...demand.values].sort((left, right) => left - right),
  }))

function exactDemandFingerprint(demand: ExactDemand): string {
  return JSON.stringify(demand)
}

const exactDemandTraceArbitrary = fc
  .uniqueArray(exactDemandArbitrary, {
    minLength: 1,
    maxLength: 6,
    selector: exactDemandFingerprint,
  })
  .chain((pool) =>
    fc
      .array(fc.integer({ min: 0, max: pool.length - 1 }), {
        minLength: 1,
        maxLength: 20,
      })
      .map((indices) => indices.map((index) => pool[index]!)),
  )

const concurrentExactScenarioArbitrary: fc.Arbitrary<ConcurrentExactScenario> =
  fc.record({
    trace: exactDemandTraceArbitrary,
    settlementOrder: fc.constantFrom(`forward` as const, `reverse` as const),
  })

function assertCompletedExactDemandTrace(
  trace: ReadonlyArray<ExactDemand>,
): void {
  let starts = 0
  const completed = new Set<string>()
  let expectedStart: LoadSubsetOptions | undefined
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: (options) => {
      expect(options).toEqual(expectedStart)
      starts++
      return true
    },
  })

  for (const demand of trace) {
    const startsBefore = starts
    expectedStart = toLoadSubsetOptions(demand)
    const result = dedupe.loadSubset(expectedStart)
    const fingerprint = exactDemandFingerprint(demand)
    expect(result).toBe(true)
    expect(starts - startsBefore).toBe(completed.has(fingerprint) ? 0 : 1)
    completed.add(fingerprint)
  }
}

async function assertConcurrentExactDemandTrace({
  trace,
  settlementOrder,
}: ConcurrentExactScenario): Promise<void> {
  const transports: Array<{
    deferred: ReturnType<typeof createDeferred<void>>
    promise: Promise<void>
  }> = []
  const promisesByDemand = new Map<string, Promise<void>>()
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => {
      const deferred = createDeferred<void>()
      const transport = { deferred, promise: deferred.promise }
      transports.push(transport)
      return transport.promise
    },
  })

  const callers = trace.map((demand) => {
    const fingerprint = exactDemandFingerprint(demand)
    const startsBefore = transports.length
    const result = dedupe.loadSubset(toLoadSubsetOptions(demand))
    if (!(result instanceof Promise)) {
      throw new Error(`A new in-flight demand must return a promise`)
    }
    const existing = promisesByDemand.get(fingerprint)
    if (existing) {
      expect(transports).toHaveLength(startsBefore)
      expect(result).toBe(existing)
    } else {
      expect(transports).toHaveLength(startsBefore + 1)
      promisesByDemand.set(fingerprint, result)
    }
    return result
  })

  const observed = Promise.allSettled(callers)
  const settlement =
    settlementOrder === `forward` ? transports : [...transports].reverse()
  for (const transport of settlement) transport.deferred.resolve()
  expect((await observed).every(({ status }) => status === `fulfilled`)).toBe(
    true,
  )

  const startsAfterSettlement = transports.length
  for (const demand of trace) {
    expect(dedupe.loadSubset(toLoadSubsetOptions(demand))).toBe(true)
  }
  expect(transports).toHaveLength(startsAfterSettlement)

  dedupe.reset()
  const restarted = dedupe.loadSubset(toLoadSubsetOptions(trace[0]!))
  expect(restarted).toBeInstanceOf(Promise)
  expect(transports).toHaveLength(startsAfterSettlement + 1)
  transports.at(-1)!.deferred.resolve()
  await restarted
}

type RejectedWaiterScenario = {
  demand: ExactDemand
  failures: number
  waiters: number
  failureKind: `error` | `undefined`
}

const rejectedWaiterScenarioArbitrary = fc.record({
  demand: exactDemandArbitrary,
  failures: fc.integer({ min: 1, max: 3 }),
  waiters: fc.integer({ min: 2, max: 4 }),
  failureKind: fc.constantFrom(`error` as const, `undefined` as const),
})

async function expectExactWaitersShareRejection({
  demand,
  failures,
  waiters,
  failureKind,
}: RejectedWaiterScenario): Promise<void> {
  const transports: Array<ReturnType<typeof createDeferred<void>>> = []
  const observed: Array<Promise<unknown>> = []
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => {
      const deferred = createDeferred<void>()
      transports.push(deferred)
      observed.push(Promise.allSettled([deferred.promise]))
      return deferred.promise
    },
  })
  let previous: LoadSubsetRequestResult | undefined
  try {
    for (let attempt = 0; attempt <= failures; attempt++) {
      const callers: Array<LoadSubsetRequestResult> = []
      const settlements: Array<`fulfilled` | `rejected`> = []
      for (let waiter = 0; waiter < waiters; waiter++) {
        const result = dedupe.loadSubset(toLoadSubsetOptions(demand))
        observed.push(
          Promise.resolve(result).then(
            () => {
              settlements.push(`fulfilled`)
            },
            () => {
              settlements.push(`rejected`)
            },
          ),
        )
        callers.push(result)
        expect(result).toBeInstanceOf(Promise)
        expect(result).toBe(callers[0])
        expect(transports).toHaveLength(attempt + 1)
      }
      expect(callers[0]).not.toBe(previous)
      previous = callers[0]
      const outcomes = Promise.allSettled(callers)
      observed.push(outcomes)
      await Promise.resolve()
      await Promise.resolve()
      expect(settlements).toEqual([])

      const transport = transports[attempt]!
      if (attempt < failures) {
        const failure =
          failureKind === `error` ? new Error(`transport failed`) : undefined
        transport.reject(failure)
        for (const outcome of await outcomes) {
          expect(outcome.status).toBe(`rejected`)
          if (outcome.status === `rejected`)
            expect(outcome.reason).toBe(failure)
        }
        expect(settlements).toEqual(Array(waiters).fill(`rejected`))
      } else {
        transport.resolve()
        expect(await outcomes).toEqual(
          Array.from({ length: waiters }, () => ({
            status: `fulfilled`,
            value: undefined,
          })),
        )
        expect(settlements).toEqual(Array(waiters).fill(`fulfilled`))
      }
    }
    expect(dedupe.loadSubset(toLoadSubsetOptions(demand))).toBe(true)
    expect(transports).toHaveLength(failures + 1)
  } finally {
    for (const transport of transports) transport.resolve()
    await Promise.all(observed)
  }
}

const { multiplier, ...replay } = readOracleRunConfig()
const exactScenarioRuns = 40 * multiplier

// The checks are the drivers that run one history and compare it with the
// demand-identity model: a completed demand starts once, and only identical
// in-flight demands share a promise. The rejected-waiter driver compares each
// attempt with the transports that it expects. The grammar is the exact-demand
// trace arbitrary, which the calibration test below reads for coverage.
declareOracle({
  check: [
    assertCompletedExactDemandTrace,
    assertConcurrentExactDemandTrace,
    expectExactWaitersShareRejection,
  ],
  grammar: [exactDemandTraceArbitrary],
})

describe(`exact loadSubset demand oracle`, () => {
  it.each(exactDemandAxisPairs)(
    `distinguishes a change to %s in completed and concurrent demands`,
    async (_axis, first, second) => {
      assertCompletedExactDemandTrace([first, second, first])
      await assertConcurrentExactDemandTrace({
        trace: [first, second, first],
        settlementOrder: `reverse`,
      })
    },
  )

  it(`uses SQL unknown for nullish comparisons in the independent model`, () => {
    const missing = new PropRef<number | null>([`missing`])

    expect(
      evaluateReferenceExpression(
        new Func(`lte`, [missing, new Value(null)]),
        {},
      ),
    ).toBeNull()
    expect(
      evaluateReferenceExpression(new Func(`lt`, [missing, new Value(0)]), {}),
    ).toBeNull()
  })

  it(`generates repeated, cursor, empty, and unbounded exact demands`, () => {
    const traces = fc.sample(exactDemandTraceArbitrary, {
      seed: 1656,
      numRuns: 200,
    })
    const demands = traces.flat()

    expect(
      traces.some(
        (trace) =>
          new Set(trace.map(exactDemandFingerprint)).size < trace.length,
      ),
    ).toBe(true)
    expect(
      demands.some(({ cursorBoundary }) => cursorBoundary !== undefined),
    ).toBe(true)
    expect(demands.some(({ limit }) => limit === 0)).toBe(true)
    expect(demands.some(({ limit }) => limit === undefined)).toBe(true)
    expect(new Set(demands.map(({ offset }) => offset)).size).toBeGreaterThan(1)
  })

  fcTest.prop([exactDemandTraceArbitrary], {
    numRuns: exactScenarioRuns,
    seed: 1657,
  })(
    `starts each completed exact demand once for a fixed seed`,
    assertCompletedExactDemandTrace,
  )

  fcTest.prop(
    [exactDemandTraceArbitrary],
    oracleRandomParameters(
      exactScenarioRuns,
      replay,
      `load-subset.exact-completion`,
    ),
  )(
    `starts each completed exact demand once for a random or replayed seed`,
    assertCompletedExactDemandTrace,
  )

  fcTest.prop([concurrentExactScenarioArbitrary], {
    numRuns: exactScenarioRuns,
    seed: 1661,
  })(
    `shares only identical in-flight demands for a fixed seed`,
    assertConcurrentExactDemandTrace,
  )

  fcTest.prop(
    [concurrentExactScenarioArbitrary],
    oracleRandomParameters(
      exactScenarioRuns,
      replay,
      `load-subset.exact-inflight`,
    ),
  )(
    `shares only identical in-flight demands for a random or replayed seed`,
    assertConcurrentExactDemandTrace,
  )

  it(`reports one rejection to every exact waiter and then retries`, async () => {
    await expectExactWaitersShareRejection({
      demand: {
        values: [1, 2],
        orderField: `rank`,
        direction: `asc`,
        nulls: `last`,
        stringSort: `lexical`,
        offset: 0,
        limit: 2,
        cursorBoundary: undefined,
      },
      failures: 1,
      waiters: 2,
      failureKind: `error`,
    })
  })

  fcTest.prop([rejectedWaiterScenarioArbitrary], {
    numRuns: exactScenarioRuns,
    seed: 703027,
    examples: [
      [
        {
          demand: {
            values: [1, 2],
            orderField: `rank`,
            direction: `asc`,
            nulls: `last`,
            stringSort: `lexical`,
            offset: 0,
            limit: 2,
            cursorBoundary: undefined,
          },
          failures: 3,
          waiters: 4,
          failureKind: `undefined`,
        },
      ],
    ],
  })(
    `retries failed exact demand histories through fresh success for a fixed seed`,
    expectExactWaitersShareRejection,
  )

  fcTest.prop(
    [rejectedWaiterScenarioArbitrary],
    oracleRandomParameters(
      exactScenarioRuns,
      replay,
      `load-subset.rejected-waiter`,
    ),
  )(
    `retries failed exact demand histories through fresh success for a random or replayed seed`,
    expectExactWaitersShareRejection,
  )
})
