const multiplierText = process.env.TANSTACK_DB_ORACLE_RUNS_MULTIPLIER
const multiplier = multiplierText === undefined ? 1 : Number(multiplierText)

if (!Number.isSafeInteger(multiplier) || multiplier < 1) {
  throw new Error(
    `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER must be a positive integer`,
  )
}

/** Keeps ordinary CI bounded while allowing long randomized oracle campaigns. */
export function oracleRuns(baseRuns: number): number {
  return baseRuns * multiplier
}
