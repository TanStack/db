// Ordinary tests of the failed-traversal retry harness: a synthetic mismatch
// must shrink and replay under a fixed seed. hash-failure-retry-oracle.property.test.ts
// owns the retry law and declares its check.
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { expectFailureCut } from './hash-support.js'

describe(`getter failure does not publish partial structural hashes`, () => {
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
