import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'

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
 * cycle rejection by hash-graph.property.test.ts. The claim here is limited to
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

const replaySeedText = process.env.TANSTACK_DB_IVM_HASH_RETRY_SEED
const replayPath = process.env.TANSTACK_DB_IVM_HASH_RETRY_PATH
if (replayPath !== undefined && replaySeedText === undefined) {
  throw new Error(`TANSTACK_DB_IVM_HASH_RETRY_PATH requires a seed`)
}
const replaySeed =
  replaySeedText === undefined ? undefined : Number(replaySeedText)
if (replaySeed !== undefined && !Number.isSafeInteger(replaySeed)) {
  throw new Error(`TANSTACK_DB_IVM_HASH_RETRY_SEED must be an integer`)
}
const campaigns =
  replaySeed === undefined
    ? [
        { name: `fixed seed 205206`, seed: 205206, path: undefined },
        { name: `random seed`, seed: undefined, path: undefined },
      ]
    : [{ name: `replay`, seed: replaySeed, path: replayPath }]

function expectFailureCut(
  error: unknown,
  reads: Array<number>,
  expectedError: Error,
  expectedReads: Array<number>,
): void {
  expect(error).toBe(expectedError)
  expect(reads).toEqual(expectedReads)
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
      reads.map((_, index) => (index <= completed ? attempt : 0)),
    )
  }
  rejecting = false
  const expected = reads.map((_, index) => ({ value: value + index }))
  const result = hash(root)
  expect(result).toBe(hash(expected))
  const afterSuccess = reads.map((_, index) =>
    index <= completed ? failures + 1 : 1,
  )
  expect(reads).toEqual(afterSuccess)
  expect(hash(root)).toBe(result)
  expect(reads).toEqual(afterSuccess)
}

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

  for (const { name, seed, path } of campaigns) {
    it(`preserves failure causes and retry cuts (${name})`, () => {
      fc.assert(
        fc.property(retryHistoryArbitrary, (history) =>
          expectRetryHistory(history),
        ),
        {
          numRuns: 100,
          ...(seed === undefined ? {} : { seed }),
          ...(path === undefined ? {} : { path }),
        },
      )
    })
  }

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

  it(`shrinks and replays a retry that skips a completed sibling`, () => {
    const property = fc.property(
      fc.integer({ min: 1, max: 3 }),
      (completed) => {
        // Keep this synthetic mismatch isolated: shrinking must not replace
        // it with a failure from the production traversal.
        const error = new Error(`getter rejected`)
        const expected = [...Array.from({ length: completed + 1 }, () => 2), 0]
        const stale = [...expected]
        stale[0] = 1
        expectFailureCut(error, stale, error, expected)
      },
    )
    const failed = fc.check(property, { seed: 205203, numRuns: 1 })
    expect(failed.numShrinks).toBeGreaterThan(0)
    expect(failed.counterexamplePath).toBe(`0:0`)
    expect(failed.errorInstance).toMatchObject({ name: `AssertionError` })
    expect(failed.counterexample).toEqual([1])
    if (failed.counterexamplePath === null)
      throw new Error(`Missing retry replay path`)
    const replay = fc.check(property, {
      seed: failed.seed,
      path: failed.counterexamplePath,
      endOnFailure: true,
    })
    expect(replay.counterexample).toEqual(failed.counterexample)
    expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  })
})
