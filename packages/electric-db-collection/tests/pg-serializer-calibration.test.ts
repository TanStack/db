// Preserve the existing raw fast-check shrink/replay calibration outside the oracle campaign.
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import {
  oracleReplayTest,
  oracleRoute,
  oracleRuns,
} from '../../db/tests/oracle-config'
import {
  expectFiniteArrayContents,
  omissionCalibrationOptions,
} from './pg-serializer-property-oracle'

oracleReplayTest(it)(
  `shrinks and exactly replays omitted nonempty arrays`,
  () => {
    oracleRoute(`calibration`)
    const property = fc.property(
      fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
      (input) => expectFiniteArrayContents(input, `{}`),
    )
    const failure = fc.check(property, omissionCalibrationOptions)
    expect(failure.failed).toBe(true)
    if (!failure.failed || failure.counterexamplePath === null) {
      throw new Error(`omission fault did not produce a replayable failure`)
    }
    expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
    expect(failure.counterexample[0]).toHaveLength(1)
    const replay = fc.check(property, {
      numRuns: oracleRuns(100),
      seed: failure.seed,
      path: failure.counterexamplePath,
    })
    expect(replay.failed).toBe(true)
    expect(replay.counterexample).toEqual(failure.counterexample)
    expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  },
)
