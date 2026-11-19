import fc from 'fast-check'
import { describe, expect } from 'vitest'
import { createDeferred } from '../../src/deferred.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { oracleProperty } from '../oracle-config.js'
import {
  exactDemandAxisPairs,
  toLoadSubsetOptions,
} from './load-subset-support.js'
import {
  exactDemandArbitrary,
  exactDemandFingerprint,
  exactDemandTraceArbitrary,
} from './load-subset-grammar-oracle.js'
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
      oracleAssertion(`assertCompletedExactDemandTrace comparison 1`, () =>
        expect(options).toEqual(expectedStart),
      )
      starts++
      return true
    },
  })

  for (const demand of trace) {
    const startsBefore = starts
    expectedStart = toLoadSubsetOptions(demand)
    const result = dedupe.loadSubset(expectedStart)
    const fingerprint = exactDemandFingerprint(demand)
    oracleAssertion(`assertCompletedExactDemandTrace comparison 2`, () =>
      expect(result).toBe(true),
    )
    oracleAssertion(`assertCompletedExactDemandTrace comparison 3`, () =>
      expect(starts - startsBefore).toBe(completed.has(fingerprint) ? 0 : 1),
    )
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
      oracleAssertion(`assertConcurrentExactDemandTrace comparison 4`, () =>
        expect(transports).toHaveLength(startsBefore),
      )
      oracleAssertion(`assertConcurrentExactDemandTrace comparison 5`, () =>
        expect(result).toBe(existing),
      )
    } else {
      oracleAssertion(`assertConcurrentExactDemandTrace comparison 6`, () =>
        expect(transports).toHaveLength(startsBefore + 1),
      )
      promisesByDemand.set(fingerprint, result)
    }
    return result
  })

  const observed = Promise.allSettled(callers)
  const settlement =
    settlementOrder === `forward` ? transports : [...transports].reverse()
  for (const transport of settlement) transport.deferred.resolve()
  const settledCallers = await observed
  oracleAssertion(`assertConcurrentExactDemandTrace comparison 7`, () =>
    expect(settledCallers.every(({ status }) => status === `fulfilled`)).toBe(
      true,
    ),
  )

  const startsAfterSettlement = transports.length
  for (const demand of trace) {
    const completedResult = dedupe.loadSubset(toLoadSubsetOptions(demand))
    oracleAssertion(`assertConcurrentExactDemandTrace comparison 8`, () =>
      expect(completedResult).toBe(true),
    )
  }
  oracleAssertion(`assertConcurrentExactDemandTrace comparison 9`, () =>
    expect(transports).toHaveLength(startsAfterSettlement),
  )

  dedupe.reset()
  const restarted = dedupe.loadSubset(toLoadSubsetOptions(trace[0]!))
  oracleAssertion(`assertConcurrentExactDemandTrace comparison 10`, () =>
    expect(restarted).toBeInstanceOf(Promise),
  )
  oracleAssertion(`assertConcurrentExactDemandTrace comparison 11`, () =>
    expect(transports).toHaveLength(startsAfterSettlement + 1),
  )
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
        oracleAssertion(`expectExactWaitersShareRejection comparison 12`, () =>
          expect(result).toBeInstanceOf(Promise),
        )
        oracleAssertion(`expectExactWaitersShareRejection comparison 13`, () =>
          expect(result).toBe(callers[0]),
        )
        oracleAssertion(`expectExactWaitersShareRejection comparison 14`, () =>
          expect(transports).toHaveLength(attempt + 1),
        )
      }
      oracleAssertion(`expectExactWaitersShareRejection comparison 15`, () =>
        expect(callers[0]).not.toBe(previous),
      )
      previous = callers[0]
      const outcomes = Promise.allSettled(callers)
      observed.push(outcomes)
      await Promise.resolve()
      await Promise.resolve()
      oracleAssertion(`expectExactWaitersShareRejection comparison 16`, () =>
        expect(settlements).toEqual([]),
      )

      const transport = transports[attempt]!
      if (attempt < failures) {
        const failure =
          failureKind === `error` ? new Error(`transport failed`) : undefined
        transport.reject(failure)
        for (const outcome of await outcomes) {
          oracleAssertion(
            `expectExactWaitersShareRejection comparison 17`,
            () => expect(outcome.status).toBe(`rejected`),
          )
          if (outcome.status === `rejected`)
            oracleAssertion(
              `expectExactWaitersShareRejection comparison 18`,
              () => expect(outcome.reason).toBe(failure),
            )
        }
        oracleAssertion(`expectExactWaitersShareRejection comparison 19`, () =>
          expect(settlements).toEqual(Array(waiters).fill(`rejected`)),
        )
      } else {
        transport.resolve()
        const completedOutcomes = await outcomes
        oracleAssertion(`expectExactWaitersShareRejection comparison 20`, () =>
          expect(completedOutcomes).toEqual(
            Array.from({ length: waiters }, () => ({
              status: `fulfilled`,
              value: undefined,
            })),
          ),
        )
        oracleAssertion(`expectExactWaitersShareRejection comparison 21`, () =>
          expect(settlements).toEqual(Array(waiters).fill(`fulfilled`)),
        )
      }
    }
    const completedResult = dedupe.loadSubset(toLoadSubsetOptions(demand))
    oracleAssertion(`expectExactWaitersShareRejection comparison 22`, () =>
      expect(completedResult).toBe(true),
    )
    oracleAssertion(`expectExactWaitersShareRejection comparison 23`, () =>
      expect(transports).toHaveLength(failures + 1),
    )
  } finally {
    for (const transport of transports) transport.resolve()
    await Promise.all(observed)
  }
}

// The checks are the drivers that run one history and compare it with the
// demand-identity model: a completed demand starts once, and only identical
// in-flight demands share a promise. The rejected-waiter driver compares each
// attempt with the transports that it expects. The grammar is the exact-demand
// trace arbitrary in load-subset-grammar-oracle.ts; its coverage check and the
// independent model's nullish rule are checked in load-subset-model.test.ts.

describe(`exact loadSubset demand oracle`, () => {
  // One demand pair per identity axis, each through both exact-demand
  // drivers: the completed trace and the reverse-settled concurrent trace.
  oracleProperty({
    id: `load-subset.exact-axis-pairs`,
    law: {
      statement: `A change to any one exact-demand axis makes a distinct demand: a completed demand starts once, and only identical in-flight demands share a promise.`,
      authority: `ARCHITECTURE.md Demand grouping and ownership; the exact-demand law above.`,
      limits: `One demand pair per identity axis in exactDemandAxisPairs, as the trace [first, second, first], completed and concurrent with reverse settlement.`,
    },
    owns: ['src/query/subset-dedupe.ts'],
    histories: exactDemandAxisPairs,
    label: ([axis]) =>
      `distinguishes a change to ${axis} in completed and concurrent demands`,
    resolve: (pair) => ({ pair }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `load-subset.exact-axis-pairs`,
        plan,
        observe,
        async () => {
          const [, first, second] = plan.pair
          assertCompletedExactDemandTrace([first, second, first])
          await assertConcurrentExactDemandTrace({
            trace: [first, second, first],
            settlementOrder: `reverse`,
          })
        },
      ),
    check: forwardAssertionJudgment,
  })

  // All three native registrations retain the existing independent helpers.
  // Assertion judgments stay at their original cuts; data-only traces carry
  // their verdict kinds while the adapter retains exact diagnostic objects.
  oracleProperty({
    id: `load-subset.exact-completion`,
    law: {
      statement: `Every completed exact demand starts once and distinct demands start independently.`,
      authority: `ARCHITECTURE.md Demand grouping and ownership; the exact-demand law above.`,
      limits: `The unchanged bounded exact-demand trace grammar without abort signals; no broader coverage or row ownership claim.`,
    },
    owns: ['src/query/subset-dedupe.ts'],
    histories: {
      arbitrary: exactDemandTraceArbitrary,
      runs: 40,
      fixedSeeds: [1657],
      states: [],
      constructed: [],
    },
    resolve: (trace) => ({ trace }),
    model: recordedAssertionJudgment,
    driver: (plan: { trace: ReadonlyArray<ExactDemand> }, observe) =>
      recordAssertionJudgment(
        `load-subset.exact-completion`,
        plan,
        observe,
        () => assertCompletedExactDemandTrace(plan.trace),
      ),
    check: forwardAssertionJudgment,
  })
  oracleProperty({
    id: `load-subset.exact-inflight`,
    law: {
      statement: `Only identical in-flight demands share a transport and the same promise, in either settlement order.`,
      authority: `ARCHITECTURE.md Demand grouping and ownership; the exact-demand law above.`,
      limits: `The unchanged concurrent exact-demand grammar, with forward/reverse settlement and reset, without independent cancellation.`,
    },
    owns: ['src/query/subset-dedupe.ts'],
    histories: {
      arbitrary: concurrentExactScenarioArbitrary,
      runs: 40,
      fixedSeeds: [1661],
      states: [],
      constructed: [],
    },
    resolve: (scenario) => ({ scenario }),
    model: recordedAssertionJudgment,
    driver: (plan: { scenario: ConcurrentExactScenario }, observe) =>
      recordAssertionJudgment(`load-subset.exact-inflight`, plan, observe, () =>
        assertConcurrentExactDemandTrace(plan.scenario),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `load-subset.rejected-waiter`,
    law: {
      statement: `Every exact waiter receives the same rejection and each later attempt starts fresh work until success is cached.`,
      authority: `ARCHITECTURE.md Demand grouping and ownership; the rejection and retry law above.`,
      limits: `The unchanged one-to-three failures with two-to-four waiters and Error/undefined rejection values; no applied-settlement claim.`,
    },
    owns: ['src/query/subset-dedupe.ts'],
    histories: {
      arbitrary: rejectedWaiterScenarioArbitrary,
      runs: 40,
      fixedSeeds: [703027],
      states: [],
      constructed: [],
    },
    resolve: (scenario) => ({ scenario }),
    model: recordedAssertionJudgment,
    driver: (plan: { scenario: RejectedWaiterScenario }, observe) =>
      recordAssertionJudgment(
        `load-subset.rejected-waiter`,
        plan,
        observe,
        () => expectExactWaitersShareRejection(plan.scenario),
      ),
    check: forwardAssertionJudgment,
  })

  // Named rejected-waiter scenarios. The generated demand grammar maps its
  // values without an unmapper, so it cannot take them back; each replays
  // through the same helper under its old test name. The second was the
  // fixed-seed campaign's explicit example.
  const rejectedWaiterDemand: ExactDemand = {
    values: [1, 2],
    orderField: `rank`,
    direction: `asc`,
    nulls: `last`,
    stringSort: `lexical`,
    offset: 0,
    limit: 2,
    cursorBoundary: undefined,
  }
  oracleProperty({
    id: `load-subset.rejected-waiter-fixed`,
    law: {
      statement: `Every exact waiter receives the same rejection and each later attempt starts fresh work until success is cached.`,
      authority: `ARCHITECTURE.md Demand grouping and ownership; the rejection and retry law above.`,
      limits: `Two named scenarios: one Error rejection with two waiters, and three undefined rejections with four waiters.`,
    },
    owns: ['src/query/subset-dedupe.ts'],
    histories: [
      {
        name: `reports one rejection to every exact waiter and then retries`,
        scenario: {
          demand: rejectedWaiterDemand,
          failures: 1,
          waiters: 2,
          failureKind: `error`,
        },
      },
      {
        name: `retries an undefined rejection through a fresh successful acquisition`,
        scenario: {
          demand: rejectedWaiterDemand,
          failures: 3,
          waiters: 4,
          failureKind: `undefined`,
        },
      },
    ] satisfies Array<{ name: string; scenario: RejectedWaiterScenario }>,
    label: ({ name }) => name,
    resolve: ({ scenario }) => ({ scenario }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `load-subset.rejected-waiter`,
        plan,
        observe,
        () => expectExactWaitersShareRejection(plan.scenario),
      ),
    check: forwardAssertionJudgment,
  })
})
