import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { areValuesEqual, ascComparator } from '../src/utils/comparison'
import { oracleFixedSeed, oracleRoute, oracleRouteOf } from './oracle-config.js'
import { defaultOpts } from './comparison-options.js'
import {
  arbitraryChangedBytes,
  assertChangedBytes,
  assertTransitive,
  checkAntisymmetry,
} from './comparison-laws-oracle'
import {
  assertComparisonProperty,
  checkWithOriginalFailure,
  failureCheckpoint,
} from './comparison-failure-support'

describe(`comparison law controls`, () => {
  fcTest(
    `shrinking retains the first violated law and replays its checkpoint`,
    () => {
      oracleRoute(`calibration`)
      let reachedOtherLaw = false
      const arbitrary = fc.integer({ min: 0, max: 10 })
      const check = (value: number) => {
        if (value > 0) expect(value, `positive-value law`).toBe(0)
        reachedOtherLaw = true
        expect(value, `zero-value law`).toBe(1)
      }
      const originalRun = checkWithOriginalFailure(arbitrary, check, {
        seed: 20260911,
        numRuns: 1,
        examples: [[5]],
      })
      expect(originalRun.result.failed).toBe(true)
      expect(reachedOtherLaw).toBe(true)
      expect(originalRun.result.counterexample).toEqual([1])
      expect(originalRun.original?.checkpoint).toBe(
        originalRun.reduced?.checkpoint,
      )
      if (originalRun.result.counterexamplePath === null) {
        throw new Error(`stable failure did not produce a replay path`)
      }
      const replay = checkWithOriginalFailure(arbitrary, check, {
        seed: originalRun.result.seed,
        path: originalRun.result.counterexamplePath,
        numRuns: 1,
        endOnFailure: true,
        examples: [[5]],
      })
      expect(replay.result.failed).toBe(true)
      expect(replay.original?.checkpoint).toBe(originalRun.original?.checkpoint)
      expect(replay.result.counterexample).toEqual(
        originalRun.result.counterexample,
      )

      let reported: unknown
      try {
        assertComparisonProperty(
          `synthetic two-law control`,
          arbitrary,
          check,
          { seed: 20260911, numRuns: 1, examples: [[5]] },
        )
      } catch (error) {
        reported = error
      }
      expect(reported).toBeInstanceOf(Error)
      expect((reported as Error).message).toContain(
        `direct replay reproduced that violation`,
      )
      expect((reported as Error).message).toContain(
        originalRun.original?.checkpoint,
      )
      expect((reported as Error).cause).toBeInstanceOf(Error)
      expect(failureCheckpoint((reported as Error).cause)).toBe(
        originalRun.original?.checkpoint,
      )
    },
  )

  fcTest(`rejects invalid results and accepts signed infinity`, () => {
    oracleRoute(`case`)
    for (const invalid of [NaN, `invalid`, undefined]) {
      expect(() => checkAntisymmetry(invalid, 0)).toThrow(
        `comparator result must be a number other than NaN`,
      )
    }
    // An earlier finite-only check rejected this legal custom comparator sign.
    expect(checkAntisymmetry(-Infinity, Infinity)).toBe(true)
    expect(checkAntisymmetry(Infinity, -Infinity)).toBe(true)
    expect(checkAntisymmetry(0, -0)).toBe(true)
    expect(checkAntisymmetry(-12, 12)).toBe(true)
    expect(checkAntisymmetry(-12, -12)).toBe(false)
  })

  fcTest(
    `rejects and replays a comparator returning NaN only for unequal pairs`,
    () => {
      oracleRoute(`calibration`)
      const mutant = (a: number, b: number): number => (a === b ? 0 : NaN)
      const property = fc.property(fc.integer({ min: -100, max: 100 }), (a) => {
        expect(mutant(a, a)).toBe(0)
        expect(checkAntisymmetry(mutant(a, a + 1), mutant(a + 1, a))).toBe(true)
      })
      const failure = fc.check(property, { seed: 20260911, numRuns: 20 })
      expect(failure.failed).toBe(true)
      expect(String(failure.errorInstance)).toContain(
        `comparator result must be a number other than NaN`,
      )
      expect(failure.counterexample).toEqual([0])
      if (failure.counterexamplePath === null) {
        throw new Error(`mutant did not produce a replay path`)
      }
      const replay = fc.check(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        numRuns: 1,
        endOnFailure: true,
      })
      expect(replay.failed).toBe(true)
      expect(String(replay.errorInstance)).toContain(
        `comparator result must be a number other than NaN`,
      )
      expect(replay.counterexample).toEqual(failure.counterexample)
    },
  )

  fcTest(
    `changed-byte law rejects length-only equality and accepts indexed equality`,
    () => {
      oracleRoute(`calibration`)
      const sample = {
        bytes: new Uint8Array([255]),
        changed: new Uint8Array([0]),
        index: 0,
      }
      expect(() =>
        assertChangedBytes(sample, (a, b) => a.length === b.length),
      ).toThrow(`changed byte must be unequal`)
      assertChangedBytes(
        sample,
        (a, b) =>
          a.length === b.length && a.every((byte, index) => byte === b[index]),
      )
    },
  )

  fcTest(`fixed campaign reaches a changed byte in every case`, () => {
    const parameters = oracleFixedSeed(20260911, { numRuns: 100 })
    oracleRoute(oracleRouteOf(parameters))
    const result = fc.check(
      fc.property(arbitraryChangedBytes, (sample) => {
        assertChangedBytes(sample, areValuesEqual)
      }),
      parameters,
    )
    expect(result).toMatchObject({ failed: false, numRuns: 100, numSkips: 0 })
  })

  it(`transitivity reaches a strict chain and rejects a cyclic order`, () => {
    oracleRoute(`calibration`)
    const [a, b, c] = [0, 1, 2]
    const ab = ascComparator(a, b, defaultOpts)
    const bc = ascComparator(b, c, defaultOpts)
    const ac = ascComparator(a, c, defaultOpts)
    expect(ab).toBeLessThan(0)
    expect(bc).toBeLessThan(0)
    assertTransitive(ab, bc, ac)

    // The wrong rule preserves adjacent order but reverses the 0-to-2 edge.
    expect(() => assertTransitive(-1, -1, 1)).toThrow()
  })
})
