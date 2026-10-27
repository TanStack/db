import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import { expectFailureCut } from './hash-support.js'

/**
 * A failed structural traversal must publish no reusable hash state.
 *
 * The model is a left-to-right row of observable getters. One getter rejects
 * for several attempts, then succeeds. Each failure may read only the prefix
 * through that getter; a later retry must read that prefix again, finish the
 * untouched tail, and agree with a plain structural copy. Only the successful
 * traversal may make a later call read nothing. This separates atomic cache
 * publication from cycle, depth, and work-limit rejection.
 *
 * This is the established structural-hash retry contract, also exercised for
 * cycle rejection by hash-graph-oracle.property.test.ts. The claim here is limited to
 * serial calls on one previously uncached array of plain objects with one
 * rejecting getter. It does not cover pre-cached descendants, shared objects,
 * reentrant getters, other containers, or other rejection causes.
 */

type History = {
  completed: number
  tail: number
  failures: number
  value: number
}

// The model-only row has `completed` successful getter reads before the
// rejecting getter and `tail` untouched getters after it. Each failed attempt
// is followed by another failed attempt or one success; success is terminal.
// Ablating `completed` loses an already-read sibling; ablating `tail` loses the
// never-read suffix; ablating `failures` loses repeated rejection. `value` is
// not needed for those read-count laws, but varies the successful digest-copy
// relation. The bounded domain is 0..3 completed, 0..2 tail, 1..3 failures,
// and -20..20 value. A success followed by another rejection is outside this
// grammar; the array and getters themselves stay unchanged.
const retryHistoryArbitrary = fc.record({
  completed: fc.integer({ min: 0, max: 3 }),
  tail: fc.integer({ min: 0, max: 2 }),
  failures: fc.integer({ min: 1, max: 3 }),
  value: fc.integer({ min: -20, max: 20 }),
})

// The fixed campaign is stable. The random campaign is a fresh seed, or the
// recorded seed and path of this property when replayed.
const retryProperty = `ivm.hash-failure-retry`

// Model: after a failed attempt, the prefix through the rejecting getter has
// been read once more, and the untouched tail has not been read at all.
function expectedFailedReads(
  completed: number,
  length: number,
  attempt: number,
): Array<number> {
  return Array.from({ length }, (_, index) =>
    index <= completed ? attempt : 0,
  )
}

// Model: after the successful traversal, the prefix has been read on every
// attempt plus the success, and the tail is read once by the success.
function expectedSuccessReads(
  completed: number,
  length: number,
  failures: number,
): Array<number> {
  return Array.from({ length }, (_, index) =>
    index <= completed ? failures + 1 : 1,
  )
}

// Model: the plain structural copy whose hash the successful root must match.
function expectedPlainCopy(
  length: number,
  value: number,
): Array<{ value: number }> {
  return Array.from({ length }, (_, index) => ({ value: value + index }))
}

function expectRetryHistory(history: History): void {
  const { completed, tail, failures, value } = history
  const error = new Error(`getter rejected`)
  const reads = Array.from({ length: completed + 1 + tail }, () => 0)
  let rejecting = true
  const root = reads.map((_, index) => ({
    get value() {
      reads[index]!++
      if (index === completed && rejecting) throw error
      return value + index
    },
  }))
  // Source contract: structural caches commit only after a successful root
  // traversal. A thrown getter is distinct from cycle/work/depth rejection.
  for (let attempt = 1; attempt <= failures; attempt++) {
    let actualError: unknown
    try {
      hash(root)
    } catch (cause) {
      actualError = cause
    }
    expectFailureCut(
      actualError,
      [...reads],
      error,
      expectedFailedReads(completed, reads.length, attempt),
    )
  }
  rejecting = false
  const expected = expectedPlainCopy(reads.length, value)
  const result = hash(root)
  expect(result).toBe(hash(expected))
  const afterSuccess = expectedSuccessReads(completed, reads.length, failures)
  expect(reads).toEqual(afterSuccess)
  expect(hash(root)).toBe(result)
  expect(reads).toEqual(afterSuccess)
}

declareOracle({
  check: [expectRetryHistory],
  model: [expectedFailedReads, expectedSuccessReads, expectedPlainCopy],
})

describe(`getter failure does not publish partial structural hashes`, () => {
  it.each([0, 1, 2, 3])(
    `retries the same root after %s completed siblings`,
    (completed) => {
      expectRetryHistory({ completed, tail: 2, failures: 2, value: 10 })
    },
  )

  it(`retries a first-getter failure without an untouched tail`, () => {
    expectRetryHistory({ completed: 0, tail: 0, failures: 1, value: -20 })
  })

  it(`retries three failures at the last getter`, () => {
    expectRetryHistory({ completed: 3, tail: 0, failures: 3, value: 20 })
  })

  oracleReplayTest(it)(
    `preserves failure causes and retry cuts (fixed seed 205206)`,
    () => {
      fc.assert(
        fc.property(retryHistoryArbitrary, (history) =>
          expectRetryHistory(history),
        ),
        { numRuns: oracleRuns(100), seed: 205206 },
      )
    },
  )
  oracleReplayTest(it, retryProperty)(
    `preserves failure causes and retry cuts (random seed)`,
    () => {
      fc.assert(
        fc.property(retryHistoryArbitrary, (history) =>
          expectRetryHistory(history),
        ),
        oraclePropertyOptions(100, retryProperty),
      )
    },
  )

  it(`rejects cached-sibling and substituted-error observations`, () => {
    const error = new Error(`getter rejected`)
    expectFailureCut(error, [2, 2, 0], error, [2, 2, 0])
    expect(() => expectFailureCut(error, [1, 2, 0], error, [2, 2, 0])).toThrow()
    expect(() =>
      expectFailureCut(new Error(error.message), [2, 2, 0], error, [2, 2, 0]),
    ).toThrow()
    expect(() => expectFailureCut(error, [2, 2, 1], error, [2, 2, 0])).toThrow()
    expectRetryHistory({ completed: 1, tail: 1, failures: 2, value: 0 })
  })
})
