type OracleEnvironment = Record<string, string | undefined>

export type OracleReplayConfig = {
  replaySeed: number | undefined
  replayPath: string | undefined
  replayProperty: string | undefined
}

export function readOracleRunConfig(
  environment: OracleEnvironment = process.env,
): OracleReplayConfig & { multiplier: number } {
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
  const replayProperty = environment.TANSTACK_DB_ORACLE_PROPERTY
  if (seedValue === undefined) {
    if (replayPath !== undefined) {
      throw new Error(
        `TANSTACK_DB_ORACLE_PATH requires TANSTACK_DB_ORACLE_SEED`,
      )
    }
    return {
      multiplier,
      replaySeed: undefined,
      replayPath: undefined,
      replayProperty: undefined,
    }
  }

  const replaySeed = Number(seedValue)
  if (seedValue.trim() === `` || !Number.isSafeInteger(replaySeed)) {
    throw new Error(`TANSTACK_DB_ORACLE_SEED must be an integer`)
  }
  if (replayPath === undefined) {
    return {
      multiplier,
      replaySeed,
      replayPath: undefined,
      replayProperty: undefined,
    }
  }
  if (replayPath.trim() === ``) {
    throw new Error(`TANSTACK_DB_ORACLE_PATH must be non-empty`)
  }
  if (!/^\d+(?::\d+)*$/.test(replayPath)) {
    throw new Error(
      `TANSTACK_DB_ORACLE_PATH must contain colon-separated nonnegative integers`,
    )
  }
  if (replayProperty === undefined || replayProperty.trim() === ``) {
    throw new Error(
      `TANSTACK_DB_ORACLE_PATH requires TANSTACK_DB_ORACLE_PROPERTY`,
    )
  }
  return { multiplier, replaySeed, replayPath, replayProperty }
}

export function oracleRandomParameters(
  numRuns: number,
  replay: OracleReplayConfig,
  property: string,
): { numRuns: number; seed?: number; path?: string } {
  const { replaySeed, replayPath, replayProperty } = replay
  if (replaySeed === undefined) return { numRuns }
  return {
    numRuns,
    seed: replaySeed,
    ...(replayPath !== undefined && replayProperty === property
      ? { path: replayPath }
      : {}),
  }
}

const { multiplier, ...replay } = readOracleRunConfig()

/** Keeps ordinary CI bounded while allowing long randomized oracle campaigns. */
export function oracleRuns(baseRuns: number): number {
  return baseRuns * multiplier
}

/** Replays broad randomized properties when a campaign seed is supplied. */
export function oraclePropertyOptions(
  baseRuns: number,
  property: string,
): {
  numRuns: number
  seed?: number
  path?: string
} {
  return oracleRandomParameters(oracleRuns(baseRuns), replay, property)
}
