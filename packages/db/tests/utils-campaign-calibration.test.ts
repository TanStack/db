// These controls retain the original fast-check result and shrink/replay
// assertions. Production campaigns live in utils-oracle.property.test.ts.
import { describe, expect, it as vitestIt } from 'vitest'
import { fc } from '@fast-check/vitest'
import { deepEquals } from '../src/utils'
import { assertExtraProperty, expectRingLaw } from './deep-equals-support'
import {
  arbitraryExtraProperty,
  ringArbitrary,
  ringComparatorCalibration,
  ringNoSkipsCampaign,
} from './utils-campaign-grammar-oracle'
import {
  oracleFixedSeed,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
} from './oracle-config'

const it = oracleReplayTest(vitestIt)

describe(`deepEquals property-based tests`, () => {
  describe(`bounded native graph relations`, () => {
    it(`runs a fixed mixed-ring campaign without skipped antecedents`, () => {
      const parameters = oracleFixedSeed(ringNoSkipsCampaign.seed, {
        numRuns: ringNoSkipsCampaign.numRuns,
      })
      oracleRoute(oracleRouteOf(parameters))
      const result = fc.check(
        fc.property(ringArbitrary, (cells) => expectRingLaw(cells)),
        parameters,
      )
      expect(result).toMatchObject({ failed: false, numRuns: 100, numSkips: 0 })
    })
    it(`shrinks and replays a payload-blind graph comparator`, () => {
      oracleRoute(`calibration`)
      const property = fc.property(ringArbitrary, (cells) =>
        expectRingLaw(cells, () => true),
      )
      const failure = fc.check(property, ringComparatorCalibration)
      expect(failure.failed).toBe(true)
      expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
      if (failure.counterexample === null)
        throw new Error(`Missing ring replay`)
      const replay = fc.check(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        endOnFailure: true,
      })
      expect(replay.failed).toBe(true)
      expect(replay.counterexample).toEqual(failure.counterexample)
      expectRingLaw(failure.counterexample[0])
    })
  })
  describe(`inequality properties`, () => {
    it(`fixed campaign reaches an extra property in every case`, () => {
      const campaignParameters = oracleFixedSeed(20260911, { numRuns: 100 })
      oracleRoute(oracleRouteOf(campaignParameters))
      const result = fc.check(
        fc.property(arbitraryExtraProperty, (sample) => {
          assertExtraProperty(sample, deepEquals)
        }),
        campaignParameters,
      )
      expect(result).toMatchObject({ failed: false, numRuns: 100, numSkips: 0 })
    })
  })
})
