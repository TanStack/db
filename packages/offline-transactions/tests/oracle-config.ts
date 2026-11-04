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
 * campaign. `random` holds the shared property options for its random campaign: a seed
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
  // Both campaigns share one run budget: the scaled base plus the reserved fixed
  // examples. A path replay keeps its single run.
  const runs = oracleRuns(defaultRuns) + reservedRuns
  const random = oraclePropertyOptions(defaultRuns, property)
  return {
    runs,
    random: random.path === undefined ? { ...random, numRuns: runs } : random,
  }
}

/**
 * A campaign that passes fixed `examples` keeps them during a path replay.
 * fast-check counts the examples in the recorded path, so a replay without
 * them would select a different value.
 *
 * The fast-check options for one campaign. An `undefined` seed selects the random
 * campaign. A number selects the fixed-seed campaign, which keeps its ordinary run
 * budget.
 */
export function oracleCampaignOptions(
  config: ReturnType<typeof readOfflineOracleConfig>,
  seed: number | undefined,
):
  ReturnType<typeof oraclePropertyOptions> | { numRuns: number; seed: number } {
  return seed === undefined ? config.random : { numRuns: config.runs, seed }
}
