type OracleEnvironment = Record<string, string | undefined>

export function readOracleRunConfig(
  environment: OracleEnvironment = process.env,
): {
  multiplier: number
  replaySeed: number | undefined
  replayPath: string | undefined
} {
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
  const replayPath = environment.TANSTACK_DB_ORACLE_PATH
  if (seedValue === undefined) {
    if (replayPath !== undefined) {
      throw new Error(
        `TANSTACK_DB_ORACLE_PATH requires TANSTACK_DB_ORACLE_SEED`,
      )
    }
    return { multiplier, replaySeed: undefined, replayPath: undefined }
  }

  const replaySeed = Number(seedValue)
  if (seedValue.trim() === `` || !Number.isSafeInteger(replaySeed)) {
    throw new Error(`TANSTACK_DB_ORACLE_SEED must be an integer`)
  }
  return { multiplier, replaySeed, replayPath }
}

export function oracleRandomParameters(
  numRuns: number,
  replaySeed: number | undefined,
  replayPath?: string,
): { numRuns: number; seed?: number; path?: string } {
  if (replaySeed === undefined) {
    if (replayPath !== undefined) {
      throw new Error(`A FastCheck replay path requires a replay seed`)
    }
    return { numRuns }
  }
  return {
    numRuns,
    seed: replaySeed,
    ...(replayPath === undefined ? {} : { path: replayPath }),
  }
}

const { multiplier, replaySeed: seed, replayPath: path } = readOracleRunConfig()

/** Keeps ordinary CI bounded while allowing long randomized oracle campaigns. */
export function oracleRuns(baseRuns: number): number {
  return baseRuns * multiplier
}

/** Replays broad randomized properties when a campaign seed is supplied. */
export function oraclePropertyOptions(baseRuns: number): {
  numRuns: number
  seed?: number
  path?: string
} {
  return oracleRandomParameters(oracleRuns(baseRuns), seed, path)
}
