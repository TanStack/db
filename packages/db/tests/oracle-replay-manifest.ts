import { registeredOracleProperties } from './oracle-config.js'

/**
 * This manifest maps a replay name to the source file that can prove it ran.
 * It is a named replay portfolio, not a catalog of every DB law. Fixed cases,
 * work bounds, provider suites, and unnamed generated properties remain
 * separate campaign gates. An absent or statistics-only entry must not be
 * promoted to assertion evidence merely because a process exited cleanly.
 */
const ownerGroups: ReadonlyArray<readonly [string, string, string]> = [
  [
    `db/tests/ssr-stream-record-wait-oracle.test.ts`,
    `ssr`,
    `stream-record-lifetime`,
  ],
  [
    `db/tests/live-query-deferred-acquisition-oracle.test.ts`,
    `live-query`,
    `start-handoff`,
  ],
  [
    `db/tests/query/pooled-live-query-gc-oracle.test.ts`,
    `pooled-live-query`,
    `late-cleanup bootstrap-ownership cleanup-peers`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `descriptor-error-surface descriptor-ownership ssr-ordinary ssr-infinite ssr-stream-cut`,
  ],
  [
    `react-db/tests/ssr-runtime-error-handoff-oracle.test.tsx`,
    `react`,
    `ssr-runtime-ordinary ssr-runtime-infinite`,
  ],
  [
    `svelte-db/tests/ssr-snapshot-admission-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-snapshot`,
  ],
  [
    `svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-handoff ssr-receiving-reader`,
  ],
  [
    `svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-runtime-errors`,
  ],
  [
    `db/tests/live-query-observer-snapshot-oracle.property.test.ts`,
    `live-query-observer`,
    `retained-snapshot`,
  ],
  [
    `db/tests/cleanup-queue-oracle.property.test.ts`,
    `cleanup-queue`,
    `history`,
  ],
  [
    `db/tests/SortedMap-oracle.test.ts`,
    `sorted-map`,
    `key ascending descending`,
  ],
  [`db/tests/oracle-replay.fixture.test.ts`, `oracle-replay`, `calibration`],
  [
    `db-ivm/tests/structural-identity-oracle.property.test.ts`,
    `structural-identity`,
    `equal-representations independent-values`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `sqlite-persistence`,
    `source-fifo-order abort-graph owner-isolation open-transaction-boundary`,
  ],
  [
    `db/tests/optimistic-transaction-oracle.property.test.ts`,
    `collection-state`,
    `mixed-transaction same-key`,
  ],
  [
    `db/tests/index-update-oracle.property.test.ts`,
    `index-update`,
    `reference-model nullish-membership exact-identity custom-comparator`,
  ],
  [
    `db/tests/cursor-oracle.property.test.ts`,
    `cursor`,
    `scalar-continuation exact-width exact-local-order partial-width partial-local-order repeat-construction`,
  ],
  [
    `db/tests/optimistic-history-outcomes-oracle.test.ts`,
    `collection-state`,
    `optimistic-outcomes`,
  ],
  [
    `db/tests/query/identity-output-shape-oracle.test.ts`,
    `query-identity`,
    `compiled-output equality-partition`,
  ],
  [
    `trailbase-db-collection/tests/lifecycle-oracle.property.test.ts`,
    `trailbase`,
    `lifecycle`,
  ],
  [
    `electric-db-collection/tests/electric-descriptor-isolation-oracle.test.ts`,
    `electric`,
    `persisted-tag-history bound-descriptor-history`,
  ],
  [
    `electric-db-collection/tests/electric-oracle.property.test.ts`,
    `electric`,
    `match-reentry publication-epoch-convergence persistence-interleaving`,
  ],
  [
    `electric-db-collection/tests/electric-recovery-oracle.test.ts`,
    `electric-recovery`,
    `publication-stream-convergence`,
  ],
  [
    `electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`,
    `electric`,
    `sdk-snapshot-delivery sdk-dnf-membership`,
  ],
  [
    `db/tests/collection-sync-reentrancy-oracle.test.ts`,
    `collection-sync`,
    `reentrant-drain`,
  ],
  [
    `db/tests/collection-gc-transaction-oracle.property.test.ts`,
    `collection-lifecycle`,
    `gc-persisting-transaction`,
  ],
  [
    `db/tests/collection-gc-mutation-oracle.property.test.ts`,
    `collection-lifecycle`,
    `gc-mutation-shapes`,
  ],
  [
    `db/tests/collection-state-retention-oracle.property.test.ts`,
    `collection-state`,
    `retention optimistic-history optimistic-history-partial accepted-snapshot.before-delete accepted-snapshot.during-delete accepted-snapshot.after-rollback`,
  ],
  [
    `db/tests/change-event-history-oracle.test.ts`,
    `collection-state`,
    `change-event-history eager-index-history`,
  ],
  [
    `db/tests/collection-metadata-publication-oracle.property.test.ts`,
    `collection-publication`,
    `metadata-only metadata-cancellation`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts`,
    `subscription-lifecycle`,
    `publication-history`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-history-oracle.property.test.ts`,
    `subscription-lifecycle`,
    `history-statistics async-history sync-history`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-oracle.test.ts`,
    `subscription-lifecycle`,
    `async-statistics async-restart notification-error`,
  ],
  [
    `db/tests/collection-subscription-replay-oracle.property.test.ts`,
    `subscription-replay`,
    `completion sequential restart same-tick shared optimistic`,
  ],
  [
    `db/tests/d2-source-reconciliation-oracle.property.test.ts`,
    `d2-source`,
    `exact-retractions changed-restart disjoint-commutation`,
  ],
  [
    `db/tests/query/cold-join-reconciliation-oracle.test.ts`,
    `cold-join`,
    `reconciliation compound`,
  ],
  [
    `db/tests/live-query-observer-history-oracle.property.test.ts`,
    `live-query-observer`,
    `granular-history wholesale-history partial-attach release-failure hydration-error-timing`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
    `sqlite-resume`,
    `startup-generation`,
  ],
  [
    `db/tests/query/derived-delete-reconciliation-oracle.test.ts`,
    `derived-publication`,
    `membership-work`,
  ],
  [
    `db/tests/query/includes-collection-oracle.property.test.ts`,
    `includes-collection`,
    `relationship-history public-key-order layout-swap optimistic-child-history`,
  ],
  [
    `db/tests/query/includes-cross-formulation-oracle.property.test.ts`,
    `includes-cross-formulation`,
    `reference-context reference-key symbol-group-route equivalence ordered-window`,
  ],
  [
    `db/tests/query/includes-optimistic-oracle.property.test.ts`,
    `includes-optimistic`,
    `rekey-detach rekey-rollback descendant-rollback ancestor-rollback confirm-same-route confirm-different-route sibling-route-rollback repeated-history`,
  ],
  [
    `db/tests/query/includes-oracle.property.test.ts`,
    `includes`,
    `scenario-statistics incremental-history nested-scalar-materialization alpha-renaming scoped-alpha-renaming optimistic-convergence`,
  ],
  [
    `db/tests/query/includes-query-shape-oracle.test.ts`,
    `includes-query-shape`,
    `correlation multiplicity nullable`,
  ],
  [
    `db/tests/query/includes-work-counter-oracle.test.ts`,
    `includes-work`,
    `correlated-links join-free join-targets`,
  ],
  [
    `db/tests/query/includes-publication-oracle.test.ts`,
    `includes-publication`,
    `child-scalar parent-route atomic-parent-replacement optimistic-rollback`,
  ],
  [
    `db/tests/query/includes-temporal-oracle.test.ts`,
    `includes-temporal`,
    `demand-scheduling release-reentry partial-values`,
  ],
  [
    `db/tests/query/load-subset-oracle.property.test.ts`,
    `load-subset`,
    `exact-completion exact-inflight rejected-waiter`,
  ],
  [
    `db/tests/query/ordered-lifecycle-oracle.property.test.ts`,
    `ordered-work`,
    `lifecycle nullable-lifecycle`,
  ],
  [
    `db/tests/query/ordered-work-oracle.property.test.ts`,
    `ordered-work`,
    `consumer-parity eager-indexed-window eager-joined-window eager-joined-gap eager-full-join eager-held-load`,
  ],
  [
    `db/tests/query/pagination-oracle.property.test.ts`,
    `pagination`,
    `multi-order nullable-cursor pending-mutation pending-history ordered-window window-transition async-cursor`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `persistence`,
    `retained-demand`,
  ],
]

const owners = new Map<string, string>()
for (const [file, prefix, suffixes] of ownerGroups) {
  for (const suffix of suffixes.split(` `)) {
    const property = `${prefix}.${suffix}`
    if (owners.has(property))
      throw new Error(`duplicate replay owner: ${property}`)
    owners.set(property, `packages/${file}`)
  }
}

// The sole computed caller: four laws × two Q1 shapes × four Q2 shapes.
// Reconciled with includes-publication-oracle.test.ts, not a prefix grep.
for (const law of [
  `parent-scalar`,
  `parent-then-child`,
  `optimistic-before-confirm`,
]) {
  for (const q1 of [`direct`, `joined`]) {
    for (const q2 of [`passThrough`, `where`, `orderBy`, `select`]) {
      owners.set(
        `includes-publication.${law}.${q1}.${q2}`,
        `packages/db/tests/query/includes-publication-oracle.test.ts`,
      )
    }
  }
}

owners.set(
  `collection-lifecycle.gc-retention-boundaries`,
  `packages/db/tests/collection-gc-retention-oracle.property.test.ts`,
)

for (const property of registeredOracleProperties) {
  if (property.startsWith(`includes.matrix.`)) {
    owners.set(
      property,
      `packages/db/tests/query/includes-oracle.property.test.ts`,
    )
  }
  if (property.startsWith(`pagination.matrix.`)) {
    owners.set(
      property,
      `packages/db/tests/query/pagination-oracle.property.test.ts`,
    )
  }
}

export type OracleReplayManifestEntry = {
  property: string
  status: `assertion` | `statistics-only` | `no-named-owner`
  file?: string
  cwd?: string
  command?: string
  testNamePattern?: string
  environment: ReadonlyArray<string>
}

// These patterns name the random/replay lane, never its fixed-seed sibling.
// Pagination cells carry their property name in the test title so the guard
// can select one cell without running the rest of the matrix.
const replayTestNames = new Map([
  [
    `collection-lifecycle.gc-mutation-shapes`,
    `retains every touched Collection across mutation shapes.*seed undefined`,
  ],
  [
    `collection-lifecycle.gc-persisting-transaction`,
    `retires a Collection only after gcTime.*seed undefined`,
  ],
  [
    `collection-lifecycle.gc-retention-boundaries`,
    `preserves retention across transaction phases.*seed undefined`,
  ],
  [
    `ssr.stream-record-lifetime`,
    `settles each record demand at its transport checkpoint.*random`,
  ],
  [
    `live-query-observer.hydration-error-timing`,
    `publishes errors at their ownership checkpoint.*random`,
  ],
  [
    `live-query-observer.retained-snapshot`,
    `first reads match the capture-time rows.*random`,
  ],
  [`live-query.start-handoff`, `reports only its own thrown starts.*random`],
  [
    `pooled-live-query.late-cleanup`,
    `releases late cleanup registration channels.*random`,
  ],
  [
    `pooled-live-query.bootstrap-ownership`,
    `bootstrap ownership after callback failure.*random`,
  ],
  [
    `pooled-live-query.cleanup-peers`,
    `cleanup status reaches every observer.*random`,
  ],
  [
    `live-query-observer.partial-attach`,
    `releases every acquired channel before retry.*random`,
  ],
  [
    `subscription-lifecycle.notification-error`,
    `acquires retained demand after replacement readiness.*random`,
  ],
  [
    `react.descriptor-error-surface`,
    `error-surface after descriptor failure.*random`,
  ],
  [`react.descriptor-ownership`, `ownership after descriptor failure.*random`],
  [`react.ssr-ordinary`, `ordinary admits reproducible SSR snapshots.*random`],
  [`react.ssr-infinite`, `infinite admits reproducible SSR snapshots.*random`],
  [`react.ssr-stream-cut`, `transports the rendered view.*random`],
  [
    `react.ssr-runtime-ordinary`,
    `ordinary preserves runtime error hydration views.*random`,
  ],
  [
    `react.ssr-runtime-infinite`,
    `infinite preserves runtime error hydration views.*random`,
  ],
  [`svelte.ssr-snapshot`, `admits reproducible SSR snapshots.*random`],
  [`svelte.ssr-handoff`, `matches the actual browser initialization.*random`],
  [
    `svelte.ssr-receiving-reader`,
    `preserves each receiving reader view.*random`,
  ],
  [
    `svelte.ssr-runtime-errors`,
    `keeps runtime failures on their ordinary error surface.*random`,
  ],
  [
    `live-query-observer.release-failure`,
    `reattaches after reporting a release failure.*random`,
  ],
  [
    `structural-identity.equal-representations`,
    `agrees with D2 value identity for equal representations`,
  ],
  [
    `structural-identity.independent-values`,
    `agrees with D2 value identity for independent values`,
  ],
  [
    `index-update.reference-model`,
    `matches a reference model across valid operation sequences \\(seed undefined\\)`,
  ],
  [
    `index-update.nullish-membership`,
    `refines nullish membership histories \\(seed undefined\\)`,
  ],
  [
    `index-update.exact-identity`,
    `preserves exact equality while ordered traversal retains every row \\(seed undefined\\)`,
  ],
  [
    `index-update.custom-comparator`,
    `matches an independent custom-comparator model \\(seed undefined\\)`,
  ],
])

function directReplayTestName(property: string): string | undefined {
  if (property === `cold-join.compound`)
    return `recomputes generated compound histories, seed=undefined`
  if (property === `oracle-replay.calibration`)
    return `executes the replay calibration property`
  if (property.startsWith(`pagination.matrix.`))
    return `\\[${property.replaceAll(`.`, `\\.`)}\\]`
  return replayTestNames.get(property)
}

export const oracleReplayManifest: ReadonlyArray<OracleReplayManifestEntry> = [
  ...registeredOracleProperties,
].map((property) => {
  const file = owners.get(property)
  const status =
    file === undefined
      ? `no-named-owner`
      : property.endsWith(`-statistics`) ||
          property.endsWith(`.scenario-statistics`)
        ? `statistics-only`
        : `assertion`
  const cwd = file?.split(`/`).slice(0, 2).join(`/`)
  return {
    property,
    status,
    file,
    cwd,
    testNamePattern: directReplayTestName(property),
    command:
      file === undefined
        ? undefined
        : `node --import tsx ${cwd === `packages/db` ? `tests` : `../db/tests`}/oracle-replay.ts ${file.split(`/`).slice(2).join(`/`)}`,
    environment:
      status === `statistics-only`
        ? [
            `TANSTACK_DB_ORACLE_STATISTICS=1 (sampling only; no exact assertion replay)`,
          ]
        : [
            `TANSTACK_DB_ORACLE_SEED`,
            `TANSTACK_DB_ORACLE_PATH`,
            `TANSTACK_DB_ORACLE_PROPERTY`,
          ],
  }
})

for (const property of owners.keys()) {
  if (!registeredOracleProperties.has(property)) {
    throw new Error(`replay owner missing from registry: ${property}`)
  }
}
