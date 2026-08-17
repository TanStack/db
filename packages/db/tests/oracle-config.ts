const multiplierText = process.env.TANSTACK_DB_ORACLE_RUNS_MULTIPLIER
const multiplier = multiplierText === undefined ? 1 : Number(multiplierText)
const seedText = process.env.TANSTACK_DB_ORACLE_SEED
const seed = seedText === undefined ? undefined : Number(seedText)

if (!Number.isSafeInteger(multiplier) || multiplier < 1) {
  throw new Error(
    `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER must be a positive integer`,
  )
}

if (seed !== undefined && !Number.isSafeInteger(seed)) {
  throw new Error(`TANSTACK_DB_ORACLE_SEED must be an integer`)
}

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
