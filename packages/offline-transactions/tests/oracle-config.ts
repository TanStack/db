import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'

type OfflineOracleConfigOptions = {
  /** A property registered in packages/db/tests/oracle-config.ts. */
  property: string
  /** The random campaign's budget before TANSTACK_DB_ORACLE_RUNS_MULTIPLIER. */
  defaultRuns: number
  /** Fixed examples that fast-check counts against the same run budget. */
  reservedRuns?: number
}

/**
 * The budgets of one offline oracle property. `runs` sizes its fixed-seed
 * lane. `random` holds the shared property options for its random lane: a seed
 * alone reseeds it, and a path replay of `property` runs its recorded history
 * once.
 */
export function readOfflineOracleConfig({
  property,
  defaultRuns,
  reservedRuns = 0,
}: OfflineOracleConfigOptions): {
  runs: number
  random: ReturnType<typeof oraclePropertyOptions>
} {
  return {
    runs: oracleRuns(defaultRuns) + reservedRuns,
    random: oraclePropertyOptions(defaultRuns + reservedRuns, property),
  }
}

/**
 * The fast-check options for one lane. An `undefined` seed selects the random
 * lane. A number selects the fixed lane, which keeps its ordinary budget.
 */
export function oracleLaneOptions(
  config: ReturnType<typeof readOfflineOracleConfig>,
  seed: number | undefined,
):
  ReturnType<typeof oraclePropertyOptions> | { numRuns: number; seed: number } {
  return seed === undefined ? config.random : { numRuns: config.runs, seed }
}
