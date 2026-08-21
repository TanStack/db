type OracleEnvironment = Record<string, string | undefined>

export function readOracleRunConfig(
  environment: OracleEnvironment = process.env,
): { multiplier: number; replaySeed: number | undefined } {
  const multiplierValue = environment.TANSTACK_DB_ORACLE_RUNS_MULTIPLIER ?? `1`
  const multiplier = Number(multiplierValue)
  if (
    multiplierValue.trim() === `` ||
    !Number.isSafeInteger(multiplier) ||
    multiplier < 1
  ) {
    throw new Error(
      `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER must be a positive integer`,
    )
  }

  const seedValue = environment.TANSTACK_DB_ORACLE_SEED
  if (seedValue === undefined) return { multiplier, replaySeed: undefined }

  const replaySeed = Number(seedValue)
  if (seedValue.trim() === `` || !Number.isSafeInteger(replaySeed)) {
    throw new Error(`TANSTACK_DB_ORACLE_SEED must be an integer`)
  }
  return { multiplier, replaySeed }
}

export function oracleRandomParameters(
  numRuns: number,
  replaySeed: number | undefined,
): { numRuns: number; seed?: number } {
  return replaySeed === undefined ? { numRuns } : { numRuns, seed: replaySeed }
}

const { multiplier, replaySeed: seed } = readOracleRunConfig()

/** Keeps ordinary CI bounded while allowing long randomized oracle campaigns. */
export function oracleRuns(baseRuns: number): number {
  return baseRuns * multiplier
}

/** Replays broad randomized properties when a campaign seed is supplied. */
export function oraclePropertyOptions(baseRuns: number): {
  numRuns: number
  seed?: number
} {
  return {
    numRuns: oracleRuns(baseRuns),
    ...(seed === undefined ? {} : { seed }),
  }
}
