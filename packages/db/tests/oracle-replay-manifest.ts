import { registeredOracleProperties } from './oracle-config.js'

// This is the named replay portfolio, not all DB laws or every test: fixed,
// work, provider, and unnamed generated suites remain separate campaign gates.
const ownerGroups: ReadonlyArray<readonly [string, string, string]> = [
  [`db/tests/cleanup-queue.property.test.ts`, `cleanup-queue`, `history`],
  [`db/tests/SortedMap.test.ts`, `sorted-map`, `key ascending descending`],
  [`db/tests/oracle-replay.fixture.test.ts`, `oracle-replay`, `calibration`],
  [
    `db/tests/optimistic-transaction-oracle.property.test.ts`,
    `collection-state`,
    `mixed-transaction`,
  ],
  [
    `db/tests/query/identity-output-shape-oracle.test.ts`,
    `query-identity`,
    `compiled-output`,
  ],
  [
    `trailbase-db-collection/tests/lifecycle-oracle.property.test.ts`,
    `trailbase`,
    `lifecycle`,
  ],
  [
    `electric-db-collection/tests/electric-descriptor-isolation.test.ts`,
    `electric`,
    `persisted-tag-history bound-descriptor-history`,
  ],
  [
    `electric-db-collection/tests/electric-oracle.property.test.ts`,
    `electric`,
    `match-reentry`,
  ],
  [
    `db/tests/collection-sync-reentrancy.test.ts`,
    `collection-sync`,
    `reentrant-drain`,
  ],
  [
    `db/tests/collection-state-retention-oracle.property.test.ts`,
    `collection-state`,
    `retention optimistic-history`,
  ],
  [
    `db/tests/collection-metadata-publication-oracle.property.test.ts`,
    `collection-publication`,
    `metadata-only metadata-cancellation`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-publication.property.test.ts`,
    `subscription-lifecycle`,
    `publication-history`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-history.property.test.ts`,
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
    `exact-retractions disjoint-commutation`,
  ],
  [
    `db/tests/query/derived-delete-reconciliation.test.ts`,
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
    `scenario-statistics incremental-history nested-scalar-materialization alpha-renaming optimistic-convergence`,
  ],
  [
    `db/tests/query/includes-publication-oracle.test.ts`,
    `includes-publication`,
    `child-scalar parent-route atomic-parent-replacement optimistic-rollback`,
  ],
  [
    `db/tests/query/includes-temporal-oracle.test.ts`,
    `includes-temporal`,
    `demand-scheduling release-reentry`,
  ],
  [
    `db/tests/query/load-subset-oracle.property.test.ts`,
    `load-subset`,
    `exact-completion exact-inflight rejected-waiter`,
  ],
  [
    `db/tests/query/ordered-lifecycle-oracle.property.test.ts`,
    `ordered-work`,
    `lifecycle`,
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
  `optimistic-after-confirm`,
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

export type OracleReplayManifestEntry = {
  property: string
  status: `assertion` | `statistics-only` | `no-named-owner`
  file?: string
  cwd?: string
  command?: string
  environment: ReadonlyArray<string>
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
