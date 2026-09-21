type OracleEnvironment = Record<string, string | undefined>

type OfflineOracleConfigOptions = {
  prefix: `OFFLINE_ORACLE` | `TANSTACK_DB_OFFLINE_ORACLE`
  defaultRuns: number
  defaultSeed?: number
  environment?: OracleEnvironment
}

export function readOfflineOracleConfig({
  prefix,
  defaultRuns,
  defaultSeed,
  environment = process.env,
}: OfflineOracleConfigOptions): {
  runs: number
  seed: number | undefined
  path: string | undefined
} {
  const runsText = environment[`${prefix}_RUNS`] ?? String(defaultRuns)
  const runs = Number(runsText)
  if (runsText.trim() === `` || !Number.isSafeInteger(runs) || runs < 1) {
    throw new Error(`Invalid ${prefix}_RUNS`)
  }

  const seedText = environment[`${prefix}_SEED`]
  const seed = seedText === undefined ? defaultSeed : Number(seedText)
  if (
    seedText !== undefined &&
    (seedText.trim() === `` || !Number.isSafeInteger(seed))
  ) {
    throw new Error(`Invalid ${prefix}_SEED`)
  }

  const path = environment[`${prefix}_PATH`]
  if (
    path !== undefined &&
    (seed === undefined || !/^\d+(?::\d+)*$/.test(path))
  ) {
    throw new Error(`${prefix}_PATH requires a seed and numeric shrink path`)
  }

  return { runs, seed, path }
}
