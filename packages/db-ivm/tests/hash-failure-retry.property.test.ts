import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'

type History = {
  completed: number
  tail: number
  failures: number
  value: number
}

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
  it.each([1, 2, 3])(
    `retries the same root after %s completed siblings`,
    (completed) => {
      expectRetryHistory({ completed, tail: 2, failures: 2, value: 10 })
    },
  )

  for (const seed of [205206, fc.sample(fc.integer(), 1)[0]!]) {
    it(`preserves failure causes and retry cuts (${seed})`, () => {
      fc.assert(
        fc.property(
          fc.record({
            completed: fc.integer({ min: 1, max: 3 }),
            tail: fc.integer({ min: 0, max: 2 }),
            failures: fc.integer({ min: 1, max: 3 }),
            value: fc.integer({ min: -20, max: 20 }),
          }),
          (history) => expectRetryHistory(history),
        ),
        { numRuns: 100, seed },
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
        expectRetryHistory({ completed, tail: 1, failures: 2, value: 0 })
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
