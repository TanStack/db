// The oracleProperty ids that the declareOracle removal adds for the
// "adapters" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  // query-db-collection (refetch)
  // query-db-collection (rest)
  // electric-db-collection
  // convex-db-collection and db-adapter-conformance
  // offline-transactions
  `offline.serializer.mutation-wire-cleanup`,
  `offline.settlement.restored`,
  `offline.settlement.started-peer`,
  `offline.connectivity-replay`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  // query-db-collection (refetch)
  // query-db-collection (rest)
  // electric-db-collection
  // convex-db-collection and db-adapter-conformance
  // offline-transactions
  [
    `offline-transactions/tests/transaction-serializer-oracle.property.test.ts`,
    `offline`,
    `serializer.mutation-wire-cleanup`,
  ],
  [
    `offline-transactions/tests/transaction-settlement-oracle.property.test.ts`,
    `offline`,
    `settlement.restored settlement.started-peer`,
  ],
  [
    `offline-transactions/tests/connectivity-replay-oracle.test.ts`,
    `offline`,
    `connectivity-replay`,
  ],
]
