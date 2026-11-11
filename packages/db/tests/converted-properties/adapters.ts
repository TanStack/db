// The oracleProperty ids that the declareOracle removal adds for the
// "adapters" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from "./index.js";

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
];

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
];
