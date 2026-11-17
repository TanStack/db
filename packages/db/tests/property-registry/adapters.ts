// The enumerated oracleProperty ids, and their replay owners, of the
// "adapters" area: the properties that the declareOracle removal
// (2026-11-11) added. See index.ts.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  // query-db-collection (refetch)
  `query-db.refetch-ordered-prefix-fixed`,
  `query-db.refetch-ordered-prefix-cases`,
  `query-db.refetch-held-page-end-structural`,
  // query-db-collection (rest)
  `query-db.ssr-dehydration`,
  `cursor-pagination.held-response-peer`,
  `cursor-pagination.cache-cases`,
  `cursor-pagination.refresh-before-growth`,
  `cursor-pagination.exact-pages`,
  `cursor-pagination.no-peek-bridge`,
  `query-db.includes-work-counter`,
  `query-db.persisted-direct-write-window`,
  `query-db.persisted-direct-write-refetch-order`,
  `query-db.persisted-direct-duplicate-insert`,
  // electric-db-collection
  `pg-serializer.array-controls`,
  `electric.persisted-tag-history-restart`,
  `electric.persisted-tag-history-recovery`,
  `electric-recovery.persisted-restart`,
  `electric-recovery.publication-stream-fixed`,
  `electric-recovery.invalid-resume`,
  `electric.mutation-confirmation`,
  `electric.initial-tagged-move-outs-cases`,
  `electric.process-grammar-fixed`,
  `electric.publication-before-persistence-fixed`,
  `electric.adapter-failure-policy-fixed`,
  `electric.design-witnesses`,
  `electric.retry-decision-fixed`,
  `electric.durable-prefix-fixed`,
  `electric.sdk-snapshot-delivery-fixed`,
  `electric.sdk-client-retry`,
  `electric.sql-predicate-semantics-faults`,
  // convex-db-collection and db-adapter-conformance
  `adapter-conformance.eager-live-source.reference.prompt-restart`,
  `adapter-conformance.eager-live-source.reference.reconstruction`,
  `adapter-conformance.eager-live-source.reference.exclusion`,
  `convex.sdk-cache`,
  `convex.backend-pages`,
  `convex.auth-app-roles`,
  `convex.public-pagination`,
  `convex.lazy-backend`,
  // offline-transactions
  `offline.serializer.mutation-wire-cleanup`,
  `offline.settlement.restored`,
  `offline.settlement.started-peer`,
  `offline.connectivity-replay`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  // query-db-collection (refetch)
  [
    `query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts`,
    `query-db`,
    `refetch-ordered-prefix-fixed refetch-ordered-prefix-cases refetch-held-page-end-structural`,
  ],
  // query-db-collection (rest)
  [
    `query-db-collection/tests/ssr-dehydration-oracle.test.ts`,
    `query-db`,
    `ssr-dehydration`,
  ],
  [
    `query-db-collection/tests/cursor-pagination.oracle.test.ts`,
    `cursor-pagination`,
    `held-response-peer`,
  ],
  [
    `query-db-collection/tests/cursor-pagination.cache-oracle.test.ts`,
    `cursor-pagination`,
    `cache-cases`,
  ],
  [
    `query-db-collection/tests/cursor-pagination-oracle.integration.test.ts`,
    `cursor-pagination`,
    `refresh-before-growth exact-pages`,
  ],
  [
    `query-db-collection/tests/cursor-pagination-oracle.no-peek.integration.test.ts`,
    `cursor-pagination`,
    `no-peek-bridge`,
  ],
  [
    `query-db-collection/tests/includes-work-counter-oracle.test.ts`,
    `query-db`,
    `includes-work-counter`,
  ],
  [
    `query-db-collection/tests/persisted-direct-write-window.oracle.test.ts`,
    `query-db`,
    `persisted-direct-write-window persisted-direct-write-refetch-order persisted-direct-duplicate-insert`,
  ],
  // electric-db-collection
  [
    `electric-db-collection/tests/pg-serializer-oracle.property.test.ts`,
    `pg-serializer`,
    `array-controls`,
  ],
  [
    `electric-db-collection/tests/electric-descriptor-isolation-oracle.test.ts`,
    `electric`,
    `persisted-tag-history-restart persisted-tag-history-recovery`,
  ],
  [
    `electric-db-collection/tests/electric-recovery-oracle.test.ts`,
    `electric-recovery`,
    `persisted-restart publication-stream-fixed invalid-resume`,
  ],
  [
    `electric-db-collection/tests/electric-oracle.property.test.ts`,
    `electric`,
    `mutation-confirmation initial-tagged-move-outs-cases process-grammar-fixed publication-before-persistence-fixed adapter-failure-policy-fixed design-witnesses retry-decision-fixed durable-prefix-fixed`,
  ],
  [
    `electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`,
    `electric`,
    `sdk-snapshot-delivery-fixed sdk-client-retry`,
  ],
  [
    `electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts`,
    `electric`,
    `sql-predicate-semantics-faults`,
  ],
  // convex-db-collection and db-adapter-conformance
  [
    `db-adapter-conformance/tests/reference-adapter-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source.reference`,
    `prompt-restart reconstruction exclusion`,
  ],
  [
    `convex-db-collection/tests/sdk-cache-oracle.test.ts`,
    `convex`,
    `sdk-cache`,
  ],
  [
    `convex-db-collection/e2e/backend-oracle.test.ts`,
    `convex`,
    `backend-pages`,
  ],
  [
    `convex-db-collection/e2e/auth-app-oracle.test.ts`,
    `convex`,
    `auth-app-roles`,
  ],
  [
    `convex-db-collection/e2e/public-pagination-oracle.test.ts`,
    `convex`,
    `public-pagination`,
  ],
  [
    `convex-db-collection/e2e/lazy-paging-oracle.test.ts`,
    `convex`,
    `lazy-backend`,
  ],
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
