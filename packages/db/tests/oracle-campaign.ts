// Vendored from TanStack/oracles at fe532f4 during the oracleProperty migration.
// Remove this compatibility implementation when its last legacy caller converts.
import { createOracleReach } from './oracle-reach.js'
import { oracleFixedSeed, oracleRoute, oracleRouteOf } from './oracle-config.js'

// The package keeps this seed selector private after removing legacy campaigns.
// Preserve its selection and report exactly for the compatibility runner.
function oracleCampaignSeed(
  seed: number | undefined,
  property: string | undefined,
): number {
  const selected = seed ?? Math.floor(Math.random() * 0x100000000) - 0x80000000
  console.info(
    `ORACLE_SEED ${JSON.stringify({ property: property ?? null, seed: selected })}`,
  )
  return selected
}

/**
 * Run the same oracle with separate fixed/random reach ledgers. The callback
 * owns its property, grammar, recorder, comparison, and run budget; only seed
 * selection changes between the two calls. Every started campaign reports its
 * seed and counts even when the callback or reach assertion fails. Counts are histories, not events:
 * call beginHistory once and reach only after observing the named checkpoint.
 * A prefix SEED reseeds one campaign at the callback's full budget, and
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

  // A fixed seed and a replay's seed are declared fixed; the random
  // campaign's seed is drawn below.
  const campaigns: Array<{
    name: string
    parameters: { seed?: number; path?: string; numRuns?: number }
  }> =
    seed === undefined
      ? [
          { name: `fixed`, parameters: oracleFixedSeed(fixedSeed) },
          { name: `random`, parameters: {} },
        ]
      : [
          {
            name: `replay`,
            parameters: oracleFixedSeed(
              seed,
              path === undefined ? {} : { path, numRuns: 1 },
            ),
          },
        ]
  for (const campaign of campaigns) {
    const reach = createOracleReach(prefix, states, {
      replaying: path !== undefined,
    })
    const parameters = {
      ...campaign.parameters,
      seed: oracleCampaignSeed(campaign.parameters.seed, prefix),
    }
    // The gap report counts a kill only on a reproducible route, so each
    // campaign registers its own, by the one classifier (oracle-route.ts).
    oracleRoute(oracleRouteOf(parameters))
    try {
      await run(reach, parameters)
      reach.assertReached()
    } finally {
      console.info(
        `ORACLE_REACH ${JSON.stringify({
          property: prefix,
          campaign: campaign.name,
          seed: parameters.seed,
          minimum: path === undefined ? 1 : null,
          counts: Object.fromEntries(reach.counts()),
        })}`,
      )
    }
  }
}

// Preserve the historical shim's other exports while legacy callers migrate.
export * from '@tanstack/oracles'
