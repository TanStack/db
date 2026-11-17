// Preserve the existing raw fast-check shrink/replay calibration outside the oracle campaign.
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import {
  oracleReplayTest,
  oracleRoute,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { validArrays } from './pg-serializer-array-controls'
import {
  expectFiniteArrayContents,
  omissionCalibrationOptions,
} from './pg-serializer-property-oracle'
import type { FiniteArrayValue } from './pg-serializer-finite-decoder'

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

// The independent decoder reads each named control's hand-written output back
// as its input; the serializer oracle runs the same inputs through production.
oracleReplayTest(it).each(validArrays)(
  `decodes the independent $name control`,
  ({ input, output }) => {
    expectFiniteArrayContents(input, output)
  },
)

const corruptArrays: Array<{
  name: string
  input: Array<FiniteArrayValue | undefined>
  output: string
}> = [
  { name: `all booleans omitted`, input: [true], output: `{}` },
  { name: `one boolean omitted`, input: [true, false], output: `{true}` },
  {
    name: `boolean duplicated`,
    input: [true, false],
    output: `{true,false,false}`,
  },
  {
    name: `booleans reordered`,
    input: [true, false],
    output: `{false,true}`,
  },
  { name: `boolean replaced`, input: [true, false], output: `{true,true}` },
  {
    name: `nullish elements omitted`,
    input: [null, undefined],
    output: `{}`,
  },
  { name: `NULL replaced with text`, input: [null], output: `{"NULL"}` },
  { name: `text replaced with NULL`, input: [`NULL`], output: `{NULL}` },
  { name: `empty text omitted`, input: [``], output: `{}` },
  {
    name: `strings reordered`,
    input: [`left`, `right`],
    output: `{"right","left"}`,
  },
  {
    name: `one required escape omitted`,
    input: [`a"b`, `c\\d`],
    output: `{"a\\"b","cd"}`,
  },
  {
    name: `unrelated escaped content`,
    input: [`a"b`],
    output: `{"unrelated\\"text"}`,
  },
  { name: `numeric suffix`, input: [1.25], output: `{1.25junk}` },
]
oracleReplayTest(it).each(corruptArrays)(
  `rejects $name`,
  ({ input, output }) => {
    // The same observer judges production outputs above; these outputs come
    // from test-owned faults, not a mutation of the serializer or its inputs.
    expect(() => expectFiniteArrayContents(input, output)).toThrow()
  },
)
