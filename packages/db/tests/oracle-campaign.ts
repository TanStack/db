import { createOracleReach } from './oracle-reach'

/**
 * Run the same oracle with separate fixed/random reach ledgers. The callback
 * owns its property, grammar, recorder, comparison, and run budget; only seed
 * selection changes between the two calls. Counts are histories, not events:
 * call beginHistory once and reach only after observing the named checkpoint.
 * A prefix SEED replay runs one campaign at the callback's full budget, and
 * checks its reach. A SEED/PATH replay runs one recorded history and checks
 * no reach. `declared-reach-oracle.property.test.ts` owns this rule.
 * This is runner support, not an independent product judgment.
 */
export async function runOracleCampaign<TState extends string>(
  prefix: string,
  states: ReadonlyArray<TState>,
  run: (
    reach: ReturnType<typeof createOracleReach<TState>>,
    parameters: { seed?: number; path?: string; numRuns?: number },
  ) => void | Promise<void>,
  { fixedSeed = 20261022 }: { fixedSeed?: number } = {},
): Promise<void> {
  const seedText = process.env[`${prefix}_SEED`]
  const path = process.env[`${prefix}_PATH`]
  const seed = seedText === undefined ? undefined : Number(seedText)
  if (
    seedText !== undefined &&
    (seedText.trim() === `` || !Number.isSafeInteger(seed))
  ) {
    throw new Error(`${prefix}_SEED must be an integer`)
  }
  if (
    path !== undefined &&
    (seed === undefined || !/^\d+(?::\d+)*$/.test(path))
  )
    throw new Error(`${prefix}_PATH requires a seed and numeric shrink path`)

  const recordedReplay = { seed, counterexamplePath: path }
  const campaigns =
    seed === undefined
      ? [
          { name: `fixed`, parameters: { seed: fixedSeed } },
          { name: `random`, parameters: {} },
        ]
      : [
          {
            name: `replay`,
            parameters:
              path === undefined
                ? { seed }
                : { seed, path: recordedReplay.counterexamplePath, numRuns: 1 },
          },
        ]
  for (const campaign of campaigns) {
    const reach = createOracleReach(prefix, states, {
      replaying: path !== undefined,
    })
    await run(reach, campaign.parameters)
    reach.assertReached()
    console.info(
      `ORACLE_REACH ${JSON.stringify({
        property: prefix,
        campaign: campaign.name,
        minimum: path === undefined ? 1 : null,
        counts: Object.fromEntries(reach.counts()),
      })}`,
    )
  }
}
