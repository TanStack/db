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
    `reference-model exact-identity custom-comparator`,
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
    `db/tests/collection-state-retention-oracle.property.test.ts`,
    `collection-state`,
    `retention optimistic-history accepted-snapshot.before-delete accepted-snapshot.during-delete accepted-snapshot.after-rollback`,
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
    `async-statistics async-restart`,
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
    `reconciliation`,
  ],
  [
    `db/tests/live-query-observer-history-oracle.property.test.ts`,
    `live-query-observer`,
    `granular-history wholesale-history`,
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
    `consumer-parity`,
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
const indexReplayTestNames = new Map([
  [
    `index-update.reference-model`,
    `matches a reference model across valid operation sequences \\(seed undefined\\)`,
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
  if (property === `oracle-replay.calibration`)
    return `executes the replay calibration property`
  if (property.startsWith(`pagination.matrix.`))
    return `\\[${property.replaceAll(`.`, `\\.`)}\\]`
  return indexReplayTestNames.get(property)
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
