import { oracleReplayReporter } from './oracle-replay-witness.js'

type OracleEnvironment = Record<string, string | undefined>

const staticOracleProperties = [
  `cursor-pagination.no-peek`,
  `cursor-pagination.history`,
  `cursor-pagination.cache`,
  `cursor-pagination.nested-cancellation`,
  `cursor-pagination.reader-abort`,
  `cursor-pagination.manual-write`,
  `cursor-pagination.backend-ownership`,
  `cursor-pagination.refresh-publication`,
  `cursor-pagination.protocol-publication`,
  `cursor-pagination.slice-work`,
  `cursor-pagination.defaults`,
  `cursor-pagination.cancellation`,
  `cursor-pagination.partition`,
  `cursor-pagination.reset`,
  `cursor-pagination.failure`,
  `query-db.refetch-ordered-prefix`,
  `ordered-loader.request-authority`,
  `replay.ordered-window-faults`,
  `oracle-replay.calibration`,
  `structural-identity.equal-representations`,
  `structural-identity.independent-values`,
  `opfs-worker.diagnostics`,
  `indexeddb.cross-tab-history`,
  `proxy.callback-history`,
  `indexeddb.pending-history`,
  `proxy.revert-history`,
  `proxy.revert-nested-round-trips`,
  `proxy.revert-class-writes`,
  `proxy.revert-partial-reverts`,
  `proxy.revert-native-histories`,
  `proxy.native-array-methods`,
  `proxy.native-typed-methods`,
  `ivm.hash-identity`,
  `ivm.hash-identity-cycles`,
  `ivm.multiset-consolidate`,
  `electric.adapter-failure-policy`,
  `electric.design-convergence`,
  `electric.durable-prefix`,
  `electric.initial-tagged-move-outs`,
  `electric.invalid-resume-partition`,
  `electric.metadata-merge-complete-state`,
  `electric.process-grammar`,
  `electric.publication-before-persistence`,
  `electric.queued-presence-order`,
  `electric.resume-metadata-merge`,
  `electric.retry-decision`,
  `electric.subset-request-row-validity`,
  `electric.synthetic-batch-partition`,
  `electric.valid-batch-partition`,
  `ivm.index-refinement`,
  `offline.key-scheduler-fifo-ledger`,
  `offline.interruption-settlement`,
  `offline.fifo-retry`,
  `offline.leadership.serial-work`,
  `offline.leadership.report`,
  `offline.leadership.delayed-read`,
  `offline.leadership.startup`,
  `offline.leadership.stale-read`,
  `offline.leadership.storage-failure`,
  `offline.serializer.mutation-wire`,
  `offline.serializer.date-marker`,
  `offline.serializer.version-two`,
  `offline.settlement.transaction`,
  `offline.settlement.retry-record`,
  `offline.settlement.admission`,
  `offline.settlement.retry-decision`,
  `op-sqlite.columnar-sql-aliases`,
  `op-sqlite.result-carrier-equivalence`,
  `op-sqlite.write-marker-aliases`,
  `pg-serializer.array-determinism`,
  `pg-serializer.bigint-round-trip`,
  `pg-serializer.bigint-text`,
  `pg-serializer.boolean-array-contents`,
  `pg-serializer.boolean-round-trip`,
  `pg-serializer.boolean-tokens`,
  `pg-serializer.date-iso`,
  `pg-serializer.date-round-trip`,
  `pg-serializer.double-round-trip`,
  `pg-serializer.integer-array-contents`,
  `pg-serializer.integer-array-format`,
  `pg-serializer.integer-round-trip`,
  `pg-serializer.integer-text`,
  `pg-serializer.mixed-array-contents`,
  `pg-serializer.nullish-array-contents`,
  `pg-serializer.nullish-empty`,
  `pg-serializer.scalar-determinism`,
  `pg-serializer.string-array-contents`,
  `pg-serializer.string-escaping`,
  `pg-serializer.string-idempotent`,
  `pg-serializer.string-passthrough`,
  `sqlite-persistence.bigint-rejection`,
  `sqlite-persistence.bigint-roundtrip`,
  `sqlite-persistence.binding-capacity`,
  `sqlite-persistence.expression-index`,
  `sqlite-resume.baseline-lineage`,
  `sqlite-persistence.source-fifo-order`,
  `sqlite-persistence.abort-graph`,
  `sqlite-persistence.owner-isolation`,
  `sqlite-persistence.open-transaction-boundary`,
  `sqlite-persistence.request-local-failure-buffered-source`,
  `sqlite-persistence.optimistic-history`,
  `trailbase.lifecycle`,
  `trailbase.page-event`,
  `electric.bound-descriptor-history`,
  `electric.persisted-tag-history`,
  `electric.match-reentry`,
  `electric.publication-epoch-convergence`,
  `electric.persistence-interleaving`,
  `electric.sdk-snapshot-delivery`,
  `electric.sdk-dnf-membership`,
  `electric-recovery.publication-stream-convergence`,
  `sqlite-resume.startup-generation`,
  `sqlite-resume.managed-claim-read`,
  `sqlite-resume.retired-storage`,
  `sqlite-reload.class`,
  `sqlite-reload.class.electron`,
  `persistence.generation-notice`,
  `persistence.follower-remote-demand`,
  `sqlite-ordinary.write-history`,
  `sqlite-ordinary.independent-work`,
  `collection-sync.reentrant-drain`,
  `collection-state.retention`,
  `collection-state.accepted-snapshot.before-delete`,
  `collection-state.accepted-snapshot.during-delete`,
  `collection-state.accepted-snapshot.after-rollback`,
  `collection-state.change-event-history`,
  `collection-state.eager-index-history`,
  `collection-state.optimistic-history`,
  `collection-state.optimistic-history-partial`,
  `collection-state.mixed-transaction`,
  `collection-state.optimistic-outcomes`,
  `collection-state.same-key`,
  `cold-join.reconciliation`,
  `cold-join.compound`,
  `cursor.scalar-continuation`,
  `cursor.exact-width`,
  `cursor.exact-local-order`,
  `cursor.partial-width`,
  `cursor.partial-local-order`,
  `cursor.repeat-construction`,
  `index-update.reference-model`,
  `index-update.nullish-membership`,
  `index-update.exact-identity`,
  `index-update.custom-comparator`,
  `query-identity.compiled-output`,
  `query-identity.equality-partition`,
  `where-predicate.publication`,
  `join-result-key.pairs`,
  `pooled-live-query.publication`,
  `flat-change-tracking.equivalence`,
  `local-storage.value-fidelity`,
  `derived-publication.membership-work`,
  `collection-publication.metadata-cancellation`,
  `collection-publication.metadata-only`,
  `d2-source.exact-retractions`,
  `d2-source.changed-restart`,
  `d2-source.disjoint-commutation`,
  `live-query-observer.granular-history`,
  `live-query-observer.wholesale-history`,
  `live-query-observer.retained-snapshot`,
  `bucket-facade.rollback-history`,
  `aggregate.select-shapes`,
  `evaluators.in`,
  `transaction-ownership.settlement-release`,
  `includes-collection.layout-swap`,
  `includes-collection.optimistic-child-history`,
  `includes-collection.public-key-order`,
  `includes-collection.relationship-history`,
  `includes-cross-formulation.equivalence`,
  `includes-cross-formulation.ordered-window`,
  `includes-cross-formulation.reference-context`,
  `includes-cross-formulation.reference-key`,
  `includes-cross-formulation.symbol-group-route`,
  `includes-optimistic.ancestor-rollback`,
  `includes-optimistic.confirm-different-route`,
  `includes-optimistic.confirm-same-route`,
  `includes-optimistic.descendant-rollback`,
  `includes-optimistic.rekey-detach`,
  `includes-optimistic.rekey-rollback`,
  `includes-optimistic.repeated-history`,
  `includes-optimistic.sibling-route-rollback`,
  `includes-query-shape.correlation`,
  `includes-query-shape.multiplicity`,
  `includes-query-shape.nullable`,
  `includes-work.correlated-links`,
  `includes-work.join-free`,
  `includes-work.join-targets`,
  `includes-work.ordered-window`,
  `includes-publication.atomic-parent-replacement`,
  `includes-publication.child-scalar`,
  `includes-publication.optimistic-rollback`,
  `includes-publication.parent-route`,
  `includes-temporal.release-reentry`,
  `includes-temporal.partial-values`,
  `includes-temporal.demand-scheduling`,
  `includes.alpha-renaming`,
  `includes.scoped-alpha-renaming`,
  `includes.incremental-history`,
  `includes.nested-scalar-materialization`,
  `includes.optimistic-convergence`,
  `includes.scenario-statistics`,
  `load-subset.exact-completion`,
  `load-subset.exact-inflight`,
  `load-subset.rejected-waiter`,
  `ordered-work.consumer-parity`,
  `ordered-work.eager-indexed-window`,
  `ordered-work.eager-joined-window`,
  `ordered-work.eager-joined-gap`,
  `ordered-work.eager-full-join`,
  `ordered-work.eager-held-load`,
  `ordered-work.lifecycle`,
  `ordered-work.nullable-lifecycle`,
  `pagination.async-cursor`,
  `reverse-index.reads`,
  `pagination.multi-order`,
  `pagination.nullable-cursor`,
  `pagination.ordered-window`,
  `pagination.pending-history`,
  `pagination.pending-mutation`,
  `pagination.window-transition`,
  `persistence.retained-demand`,
  `subscription-replay.completion`,
  `subscription-replay.optimistic`,
  `subscription-replay.restart`,
  `subscription-replay.sequential`,
  `subscription-replay.shared`,
  `subscription-replay.same-tick`,
  `subscription-lifecycle.history-statistics`,
  `subscription-lifecycle.publication-history`,
  `subscription-lifecycle.sync-history`,
  `subscription-lifecycle.async-history`,
  `subscription-lifecycle.async-restart`,
  `subscription-lifecycle.async-statistics`,
  `sorted-map.key`,
  `cleanup-queue.history`,
  `sorted-map.ascending`,
  `sorted-map.descending`,
] as const

const publicationProperties = [
  `parent-scalar`,
  `parent-then-child`,
  `optimistic-before-confirm`,
].flatMap((law) =>
  [`direct`, `joined`].flatMap((q1Shape) =>
    [`passThrough`, `where`, `orderBy`, `select`].map(
      (q2Shape) => `includes-publication.${law}.${q1Shape}.${q2Shape}`,
    ),
  ),
)

// utils-oracle and comparison-oracle number their properties in file order.
const utilsProperties = Array.from(
  { length: 40 },
  (_, index) => `utils.${index + 1}`,
)
const comparisonProperties = Array.from(
  { length: 39 },
  (_, index) => `comparison.${index + 1}`,
)
const paginationMatrixProperties = [`window`, `state`].flatMap((family) =>
  Array.from(
    { length: 8 },
    (_, index) => `pagination.matrix.${family}-${index}`,
  ),
)

// Each includes matrix cell owns a distinct replay coordinate. Keep this
// finite registry in step with includes-oracle.property.test.ts.
const includesMatrixProperties: Array<string> = []
for (const shape of [
  `ancestor-descendant`,
  `descendant-ancestor`,
  `sibling`,
  `cross-branch`,
  `root`,
])
  includesMatrixProperties.push(`includes.matrix.independent-${shape}`)
for (const history of [`fresh`, `restore`, `merge-split`, `retired`]) {
  includesMatrixProperties.push(`includes.matrix.destination-${history}`)
}
for (const depth of [2, 3, 4]) {
  for (const branch of [0, 1]) {
    includesMatrixProperties.push(
      `includes.matrix.retired-route-${depth}-${branch}`,
      `includes.matrix.intra-batch-route-${depth}-${branch}`,
    )
  }
}
for (const depth of [3, 4]) {
  for (let level = 1; level <= depth - 2; level++) {
    for (const branch of [0, 1]) {
      includesMatrixProperties.push(
        `includes.matrix.moved-child-${depth}-${level}-${branch}`,
      )
    }
  }
}
for (const publicId of [`same`, `new`]) {
  for (const route of [`handoff`, `fresh`]) {
    for (const update of [`route-only`, `route-and-position`]) {
      includesMatrixProperties.push(
        `includes.matrix.batch-${publicId}-${route}-${update}`,
      )
    }
  }
}
includesMatrixProperties.push(`includes.matrix.flat-materialization`)
for (const depth of [1, 2, 3, 4]) {
  includesMatrixProperties.push(`includes.matrix.full-row-${depth}`)
  for (const transition of [`reparent`, `rekey`]) {
    for (let level = 1; level <= depth; level++) {
      includesMatrixProperties.push(
        `includes.matrix.visible-${depth}-${transition}-${level}`,
      )
    }
  }
  for (const first of [`reparent`, `rekey`]) {
    for (const second of [`reparent`, `rekey`]) {
      if (depth === 1 && (first === `rekey` || second === `rekey`)) continue
      for (const branch of [0, 1]) {
        includesMatrixProperties.push(
          `includes.matrix.transition-${depth}-${first}-${second}-${branch}`,
        )
      }
    }
  }
}

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

export const registeredOracleProperties = validateOraclePropertyRegistry([
  ...staticOracleProperties,
  ...publicationProperties,
  ...utilsProperties,
  ...comparisonProperties,
  ...paginationMatrixProperties,
  ...includesMatrixProperties,
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

/**
 * Replay variables that oracles read before they moved to the shared
 * TANSTACK_DB_ORACLE_* variables. Nothing reads them now, so a command that
 * still sets one would run the full campaigns and appear to pass. Reading the
 * config rejects them instead.
 */
const retiredReplayVariables = [
  `UTILS_ORACLE_PROPERTY`,
  `UTILS_ORACLE_SEED`,
  `UTILS_ORACLE_PATH`,
  `COMPARISON_ORACLE_PROPERTY`,
  `COMPARISON_ORACLE_SEED`,
  `COMPARISON_ORACLE_PATH`,
  `PG_SERIALIZER_ORACLE_PROPERTY`,
  `PG_SERIALIZER_ORACLE_SEED`,
  `PG_SERIALIZER_ORACLE_PATH`,
  `PG_SERIALIZER_ORACLE_RUNS`,
  `TANSTACK_DB_ELECTRIC_ORACLE_PROPERTY`,
  `TANSTACK_DB_ELECTRIC_HISTORY_PROPERTY`,
  `TANSTACK_DB_ELECTRIC_HISTORY_SEED`,
  `TANSTACK_DB_ELECTRIC_HISTORY_PATH`,
  `TANSTACK_DB_ELECTRIC_DURABILITY_SEED`,
  `TANSTACK_DB_ELECTRIC_DURABILITY_PATH`,
  `TANSTACK_DB_ELECTRIC_PERSISTENCE_POLICY_SEED`,
  `TANSTACK_DB_ELECTRIC_PERSISTENCE_POLICY_PATH`,
  `TANSTACK_DB_IVM_INDEX_SEED`,
  `TANSTACK_DB_IVM_INDEX_PATH`,
  `TANSTACK_DB_SQLITE_BINDING_SEED`,
  `TANSTACK_DB_SQLITE_BINDING_PATH`,
  `TANSTACK_DB_SQLITE_ORACLE_SEED`,
  `TANSTACK_DB_SQLITE_ORACLE_PATH`,
  `TANSTACK_DB_SQLITE_ORACLE_RUNS`,
  `TANSTACK_DB_WS5A_PROPERTY`,
  `TANSTACK_DB_WS5A_SEED`,
  `TANSTACK_DB_WS5A_PATH`,
  `TANSTACK_INDEXEDDB_ORACLE_SEED`,
  `TANSTACK_INDEXEDDB_ORACLE_PATH`,
  `TANSTACK_DB_PROXY_CALLBACK_SEED`,
  `TANSTACK_DB_PROXY_CALLBACK_PATH`,
  `TANSTACK_DB_PROXY_REVERT_SEED`,
  `TANSTACK_DB_PROXY_REVERT_PATH`,
  `TANSTACK_DB_PROXY_NATIVE_SEED`,
  `TANSTACK_DB_PROXY_NATIVE_PATH`,
  `TANSTACK_DB_IVM_HASH_IDENTITY_SEED`,
  `TANSTACK_DB_IVM_HASH_IDENTITY_PATH`,
  `TANSTACK_DB_IVM_CONSOLIDATE_SEED`,
  `TANSTACK_DB_IVM_CONSOLIDATE_PATH`,
  `TANSTACK_INDEXEDDB_PENDING_SEED`,
  `TANSTACK_INDEXEDDB_PENDING_PATH`,
  `TANSTACK_DB_OFFLINE_ORACLE_SEED`,
  `TANSTACK_DB_OFFLINE_ORACLE_PATH`,
  `TANSTACK_DB_OFFLINE_ORACLE_RUNS`,
  `OFFLINE_ORACLE_SEED`,
  `OFFLINE_ORACLE_PATH`,
  `OFFLINE_ORACLE_RUNS`,
] as const

export function readOracleRunConfig(
  environment: OracleEnvironment = process.env,
): OracleReplayConfig & { multiplier: number } {
  const retired = retiredReplayVariables.filter(
    (variable) => environment[variable] !== undefined,
  )
  if (retired.length > 0) {
    throw new Error(
      `Retired oracle replay variables are set: ${retired.join(`, `)}. ` +
        `Use TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH, and ` +
        `TANSTACK_DB_ORACLE_PROPERTY to select a replay, and ` +
        `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER to scale run counts.`,
    )
  }
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
  replay: OracleReplayConfig | number | undefined,
  property?: string,
): { numRuns: number; seed?: number; path?: string } & ReturnType<
  typeof oracleReplayReporter
> {
  if (property !== undefined) assertRegisteredOracleProperty(property)
  const { replaySeed, replayPath, replayProperty } =
    typeof replay === `object`
      ? replay
      : {
          replaySeed: replay,
          replayPath: undefined,
          replayProperty: undefined,
        }
  if (replaySeed === undefined) return { numRuns }
  return {
    numRuns,
    seed: replaySeed,
    // A path replays one recorded counterexample, so the replay runs once.
    // From a path with one segment, fast-check would otherwise run `numRuns`
    // histories that start at that index.
    ...(property !== undefined &&
    replayPath !== undefined &&
    replayProperty === property
      ? {
          numRuns: 1,
          path: replayPath,
          ...oracleReplayReporter(property, replaySeed, replayPath),
        }
      : {}),
  }
}

const { multiplier, ...replay } = readOracleRunConfig()

/**
 * Replay selection.
 *
 * A path replay runs one property's recorded history. Every other test
 * stands aside, so the replay reports only that history. A seed without a
 * path only reseeds the random campaigns, so every test still runs. These
 * helpers are the only replay conditions that the `oracle/no-disabled` lint
 * rule accepts. Each is false in an ordinary run, so no replay selection can
 * switch an oracle test off there.
 */

/** Whether a path replay is selected. */
export function oracleReplayRequested(): boolean {
  return replay.replayPath !== undefined
}

/**
 * Whether a path replay of a property outside `properties` is selected. A
 * test that serves several properties' replays passes all of them.
 */
export function oracleReplaySkips(
  ...properties: ReadonlyArray<string>
): boolean {
  for (const property of properties) assertRegisteredOracleProperty(property)
  return (
    replay.replayPath !== undefined &&
    (replay.replayProperty === undefined ||
      !properties.includes(replay.replayProperty))
  )
}

/**
 * The registration to use for a test that stands aside during another
 * test's replay: its `skip` form while that replay runs, and itself
 * otherwise. Without `properties`, the test stands aside during every path
 * replay. With them, it runs only when no path replay is selected or the
 * replay selects one of them.
 */
export function oracleReplayTest<TRegistration extends { skip: unknown }>(
  registration: TRegistration,
  ...properties: ReadonlyArray<string>
): TRegistration {
  const standsAside =
    properties.length === 0
      ? oracleReplayRequested()
      : oracleReplaySkips(...properties)
  // `skip` registers through the same API, so it has the registration's type.
  return standsAside ? (registration.skip as TRegistration) : registration
}

/**
 * The registration for a calibration witness. During a path replay of
 * `property`, TANSTACK_DB_ORACLE_CALIBRATION selects a hostile mutant that the
 * main property runs against, and the witness for that `fault` checks the
 * failure. The witness runs in ordinary runs and in that calibration replay.
 * It stands aside during every other path replay, where it has nothing to
 * check.
 */
export function oracleCalibrationTest<TRegistration extends { skip: unknown }>(
  registration: TRegistration,
  property: string,
  fault: string,
): TRegistration {
  const standsAside =
    oracleReplaySkips(property) ||
    (oracleReplayRequested() &&
      process.env.TANSTACK_DB_ORACLE_CALIBRATION !== fault)
  return standsAside ? (registration.skip as TRegistration) : registration
}

/** Keeps ordinary CI bounded while allowing long randomized oracle campaigns. */
export function oracleRuns(baseRuns: number): number {
  return baseRuns * multiplier
}

/** Replays broad randomized properties when a campaign seed is supplied. */
export function oraclePropertyOptions(
  baseRuns: number,
  property?: string,
): ReturnType<typeof oracleRandomParameters> {
  return oracleRandomParameters(oracleRuns(baseRuns), replay, property)
}
