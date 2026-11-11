// The oracleProperty ids that the declareOracle removal adds for the
// "db-query-ordered" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

// pagination-oracle.property.test.ts
const paginationProperties: ReadonlyArray<string> = [
  `pagination.async-cursor-fixed`,
  `pagination.boundary-refinement-failure`,
  `pagination.capped-prefix-repair`,
  `pagination.custom-collation`,
  `pagination.failed-window-replay`,
  `pagination.filtered-bounded-repair`,
  `pagination.foreign-local-boundary`,
  `pagination.inherited-locale`,
  `pagination.invalid-date-ties`,
  `pagination.linear-row-volume`,
  `pagination.locale-initial-window`,
  `pagination.multi-order-fixed`,
  `pagination.nan-key-tie`,
  `pagination.null-placement-refinement`,
  `pagination.optimistic-prefix-refill`,
  `pagination.optimistic-provider-coverage`,
  `pagination.ordered-window-fixed`,
  `pagination.pending-history-fixed`,
  `pagination.pending-mutation-calibration`,
  `pagination.pending-mutation-fixed`,
  `pagination.post-cleanup-calibration`,
  `pagination.provider-tie-expansion`,
  `pagination.reference-initial-window`,
  `pagination.rejected-cursor-retry`,
  `pagination.rejected-first-prefix`,
  `pagination.sse-boundary-refinement`,
  `pagination.sse-prefix-refresh`,
  `pagination.underfilled-bounded-repair`,
  `pagination.window-transition-fixed`,
  `pagination.zero-window-local-prefix`,
  `pagination.limit-admission-fixed`,
]
const paginationOwners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `db/tests/query/pagination-oracle.property.test.ts`,
    `pagination`,
    `async-cursor-fixed boundary-refinement-failure capped-prefix-repair custom-collation failed-window-replay filtered-bounded-repair foreign-local-boundary inherited-locale invalid-date-ties linear-row-volume locale-initial-window multi-order-fixed nan-key-tie null-placement-refinement optimistic-prefix-refill optimistic-provider-coverage ordered-window-fixed pending-history-fixed pending-mutation-calibration pending-mutation-fixed post-cleanup-calibration provider-tie-expansion reference-initial-window rejected-cursor-retry rejected-first-prefix sse-boundary-refinement sse-prefix-refresh underfilled-bounded-repair window-transition-fixed zero-window-local-prefix`,
  ],
  [
    `db/tests/query/pagination-oracle.property.test.ts`,
    `pagination`,
    `limit-admission-fixed`,
    `db/tests/query/limit-admission-oracle.ts`,
  ],
]

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
  `ordered-source-loader.staged-window`,
  `mixed-index-order.public-order`,
  `mixed-index-order.on-demand-window`,
  `derived-publication.queued-batches`,
  `replay.ordered-window-regressions`,
  `replay.ordered-window-fixed`,
  `index-path-collision.predicate`,
  `index-path-collision.subscription`,
  `index-path-collision.selected-order`,
  `index-path-collision.live-query`,
  `custom-index-order.rank-window`,
  `custom-index-order.later-eligible`,
  `custom-index-order.eager-reader`,
  `aggregate.select-fixed`,
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
  [
    `db/tests/query/ordered-source-loader-oracle.test.ts`,
    `ordered-source-loader`,
    `staged-window`,
  ],
  [
    `db/tests/query/mixed-index-order-oracle.test.ts`,
    `mixed-index-order`,
    `public-order on-demand-window`,
  ],
  [
    `db/tests/query/derived-delete-reconciliation-oracle.test.ts`,
    `derived-publication`,
    `queued-batches`,
  ],
  [
    `db/tests/query/load-subset-replay-refinement-oracle.test.ts`,
    `replay`,
    `ordered-window-regressions ordered-window-fixed`,
  ],
  [
    `db/tests/query/index-path-collision-oracle.test.ts`,
    `index-path-collision`,
    `predicate`,
  ],
  [
    `db/tests/query/index-path-collision-oracle.test.ts`,
    `index-path-collision`,
    `subscription`,
  ],
  [
    `db/tests/query/index-path-collision-oracle.test.ts`,
    `index-path-collision`,
    `selected-order`,
  ],
  [
    `db/tests/query/index-path-collision-oracle.test.ts`,
    `index-path-collision`,
    `live-query`,
  ],
  [
    `db/tests/query/custom-index-order-selection-oracle.test.ts`,
    `custom-index-order`,
    `rank-window`,
  ],
  [
    `db/tests/query/custom-index-order-selection-oracle.test.ts`,
    `custom-index-order`,
    `later-eligible`,
  ],
  [
    `db/tests/query/custom-index-order-selection-oracle.test.ts`,
    `custom-index-order`,
    `eager-reader`,
  ],
  [
    `db/tests/query/aggregate-select-oracle.property.test.ts`,
    `aggregate`,
    `select-fixed`,
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
