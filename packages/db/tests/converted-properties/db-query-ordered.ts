// The oracleProperty ids that the declareOracle removal adds for the
// "db-query-ordered" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

// pagination-oracle.property.test.ts
const paginationProperties: ReadonlyArray<string> = []
const paginationOwners: ReadonlyArray<ConvertedOwnerGroup> = []

// ordered-work-oracle.property.test.ts
const orderedWorkProperties: ReadonlyArray<string> = []
const orderedWorkOwners: ReadonlyArray<ConvertedOwnerGroup> = []

// ordered-lifecycle, bucket-facade-rollback, cold-join-reconciliation, and
// ordered-source-loader-state oracles
const lifecycleProperties: ReadonlyArray<string> = []
const lifecycleOwners: ReadonlyArray<ConvertedOwnerGroup> = []

// The remaining query oracles
const otherProperties: ReadonlyArray<string> = [
  `load-subset.transaction-refinement`,
  `load-subset.source-readiness-refinement`,
  `where-predicate.publication-fixed`,
  `pooled-live-query.publication-fixed`,
  `pooled-live-query.release-timing`,
]
const otherOwners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `db/tests/query/load-subset-transaction-refinement-oracle.test.ts`,
    `load-subset`,
    `transaction-refinement`,
  ],
  [
    `db/tests/query/load-subset-source-readiness-refinement-oracle.test.ts`,
    `load-subset`,
    `source-readiness-refinement`,
  ],
  [
    `db/tests/query/where-predicate-publication-oracle.property.test.ts`,
    `where-predicate`,
    `publication-fixed`,
  ],
  [
    `db/tests/query/pooled-live-query-oracle.property.test.ts`,
    `pooled-live-query`,
    `publication-fixed`,
  ],
  [
    `db/tests/query/pooled-live-query-gc-oracle.test.ts`,
    `pooled-live-query`,
    `release-timing`,
  ],
]

export const properties: ReadonlyArray<string> = [
  ...paginationProperties,
  ...orderedWorkProperties,
  ...lifecycleProperties,
  ...otherProperties,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  ...paginationOwners,
  ...orderedWorkOwners,
  ...lifecycleOwners,
  ...otherOwners,
]
