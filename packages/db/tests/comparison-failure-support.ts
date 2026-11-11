import { fc } from '@fast-check/vitest'
import { recordOracleReplay } from './oracle-config.js'

export type ComparisonFailure = { checkpoint: string; error: unknown }

export function failureCheckpoint(error: unknown): string {
  if (error instanceof Error) {
    // The first frame in a comparison law or campaign locates its failed
    // assertion or the call into a throwing comparator. Unlike a matcher
    // message, it is unchanged when fast-check shrinks the input values.
    const site = error.stack?.match(
      /(comparison-(?:oracle\.property\.test|laws-oracle|calibration\.test)\.ts):(\d+):(\d+)/,
    )
    if (site) return `${site[1]}:${site[2]}:${site[3]}`
    return `${error.name}: ${error.message.split(`\n`)[0]}`
  }
  return `non-Error throw: ${String(error)}`
}

export function checkWithOriginalFailure<T>(
  arbitrary: fc.Arbitrary<T>,
  check: (value: T) => void,
  options: NonNullable<Parameters<typeof fc.check>[1]>,
  replayProperty?: string,
) {
  let original: ComparisonFailure | undefined
  let reduced: ComparisonFailure | undefined
  const property = fc.property(arbitrary, (value) => {
    try {
      check(value)
    } catch (error) {
      const failure = { checkpoint: failureCheckpoint(error), error }
      original ??= failure
      // A different assertion can fail on a smaller input. It is not a
      // reproduction of the original violation, so do not shrink into it.
      if (failure.checkpoint !== original.checkpoint) return
      reduced = failure
      throw error
    }
  })
  const result = fc.check(property, options)
  if (replayProperty !== undefined) recordOracleReplay(replayProperty, result)
  return { result, original, reduced }
}

export function assertComparisonProperty<T>(
  label: string,
  arbitrary: fc.Arbitrary<T>,
  check: (value: T) => void,
  options: NonNullable<Parameters<typeof fc.check>[1]>,
  // The registered property, so a guarded replay can witness this run.
  replayProperty?: string,
): void {
  const { result, original, reduced } = checkWithOriginalFailure(
    arbitrary,
    check,
    options,
    replayProperty,
  )
  if (!result.failed) return
  if (!original || !reduced || result.counterexamplePath === null) {
    throw new Error(`${label}: failing run lost its primary comparison failure`)
  }
  const replay = checkWithOriginalFailure(arbitrary, check, {
    seed: result.seed,
    path: result.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
    examples: options.examples,
  })
  const reproduced =
    replay.result.failed &&
    replay.original?.checkpoint === original.checkpoint &&
    replay.reduced?.checkpoint === original.checkpoint
  throw new Error(
    `${label}: ${original.checkpoint} failed at the function-return checkpoint; ` +
      `reduction ${reduced.checkpoint === original.checkpoint ? `kept` : `changed`} the original violation; ` +
      `seed ${result.seed}, path ${result.counterexamplePath}; ` +
      `direct replay ${reproduced ? `reproduced` : `did not reproduce`} that violation.\n${String(result.errorInstance)}`,
    { cause: original.error },
  )
}
