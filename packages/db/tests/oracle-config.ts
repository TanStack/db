type OracleEnvironment = Record<string, string | undefined>

const staticOracleProperties = [
  `collection-sync.reentrant-drain`,
  `coverage-registry.claim-churn`,
  `coverage-registry.state-machine`,
  `includes-collection.optimistic-child-history`,
  `includes-collection.public-key-order`,
  `includes-collection.relationship-history`,
  `includes-cross-formulation.equivalence`,
  `includes-cross-formulation.ordered-window`,
  `includes-optimistic.ancestor-rollback`,
  `includes-optimistic.confirm-different-route`,
  `includes-optimistic.confirm-same-route`,
  `includes-optimistic.descendant-rollback`,
  `includes-optimistic.rekey-detach`,
  `includes-optimistic.rekey-rollback`,
  `includes-optimistic.repeated-history`,
  `includes-optimistic.sibling-route-rollback`,
  `includes-publication.atomic-parent-replacement`,
  `includes-publication.child-scalar`,
  `includes-publication.optimistic-rollback`,
  `includes-publication.parent-route`,
  `includes-temporal.demand-scheduling`,
  `includes.alpha-renaming`,
  `includes.incremental-history`,
  `includes.nested-scalar-materialization`,
  `includes.optimistic-convergence`,
  `includes.scenario-statistics`,
  `load-subset-full-flow.atomic-replacement`,
  `load-subset-full-flow.automatic-progress`,
  `load-subset-full-flow.boundary-provenance`,
  `load-subset-full-flow.consumer-parity`,
  `load-subset-full-flow.continuation-evidence`,
  `load-subset-full-flow.continuation-statistics`,
  `load-subset-full-flow.multi-source-ordered`,
  `load-subset-full-flow.multi-source-statistics`,
  `load-subset-full-flow.truncate-evidence`,
  `load-subset-lifecycle.state-machine`,
  `load-subset-projection.state-equivalence`,
  `load-subset.async-settlement`,
  `load-subset.changing-predicate`,
  `load-subset.concurrent-dedupe`,
  `load-subset.coverage`,
  `load-subset.distinct-window-predicate`,
  `load-subset.ordered-window`,
  `load-subset.rejected-waiter`,
  `ordered-work.forward-prefix`,
  `ordered-work.public-key-suffix`,
  `ordered-work.reverse-prefix`,
  `ordered-work.snapshot-reuse`,
  `pagination.async-cursor`,
  `pagination.multi-order`,
  `pagination.nullable-cursor`,
  `pagination.ordered-window`,
  `pagination.pending-history`,
  `pagination.pending-mutation`,
  `pagination.window-transition`,
  `subscription-replay.completion`,
  `subscription-replay.optimistic`,
  `subscription-replay.ownership`,
  `subscription-replay.restart`,
  `subscription-replay.sequential`,
  `subscription-replay.shared`,
] as const

const publicationProperties = [
  `parent-scalar`,
  `parent-then-child`,
  `optimistic-before-confirm`,
  `optimistic-after-confirm`,
].flatMap((law) =>
  [`direct`, `joined`].flatMap((q1Shape) =>
    [`passThrough`, `where`, `orderBy`, `select`].map(
      (q2Shape) => `includes-publication.${law}.${q1Shape}.${q2Shape}`,
    ),
  ),
)

const refinementProperties = Array.from(
  { length: 11 },
  (_, index) => `load-subset-refinement.${1_779_001 + index}`,
)

export function validateOraclePropertyRegistry(
  properties: ReadonlyArray<string>,
): ReadonlySet<string> {
  const registry = new Set<string>()
  for (const property of properties) {
    if (registry.has(property)) {
      throw new Error(`duplicate oracle property: ${property}`)
    }
    registry.add(property)
  }
  return registry
}

const registeredOracleProperties = validateOraclePropertyRegistry([
  ...staticOracleProperties,
  ...publicationProperties,
  ...refinementProperties,
])

function assertRegisteredOracleProperty(property: string): void {
  if (!registeredOracleProperties.has(property)) {
    throw new Error(`unknown oracle property: ${property}`)
  }
}

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
    if (replayProperty !== undefined) {
      throw new Error(
        `TANSTACK_DB_ORACLE_PROPERTY requires TANSTACK_DB_ORACLE_PATH`,
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
    if (replayProperty !== undefined) {
      throw new Error(
        `TANSTACK_DB_ORACLE_PROPERTY requires TANSTACK_DB_ORACLE_PATH`,
      )
    }
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
  assertRegisteredOracleProperty(replayProperty)
  return { multiplier, replaySeed, replayPath, replayProperty }
}

export function oracleRandomParameters(
  numRuns: number,
  replay: OracleReplayConfig,
  property: string,
): { numRuns: number; seed?: number; path?: string } {
  assertRegisteredOracleProperty(property)
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
