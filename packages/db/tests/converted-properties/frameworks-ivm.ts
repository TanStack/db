// The oracleProperty ids that the declareOracle removal adds for the
// "frameworks-ivm" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  // db-ivm
  `ivm.temporal-group-key`,
  `ivm.hash-identity-fixed`,
  `ivm.hash-identity-digest-collision`,
  `ivm.incrementalization-law-cells`,
  `structural-identity.representation-fixed`,
  `structural-identity.independent-values-fixed`,
  // react-db
  `react.convex-lazy-paging`,
  `react.effect-callback`,
  `react.paced-mutations-render-cuts`,
  `react.infinite-query-render-cuts.on-demand`,
  `react.infinite-query-render-cuts.sync-agreement`,
  `react.descriptor-abandoned-render-reader`,
  `react.descriptor-prebuilt-query-binding`,
  `react.ssr-ordinary-examples`,
  `react.ssr-infinite-examples`,
  `react.ssr-stream-cut-fixed`,
  // vue-db and scripts
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  // db-ivm
  [
    `db-ivm/tests/temporal-group-key-oracle.test.ts`,
    `ivm`,
    `temporal-group-key`,
  ],
  [
    `db-ivm/tests/hash-identity-oracle.property.test.ts`,
    `ivm`,
    `hash-identity-fixed hash-identity-digest-collision`,
  ],
  [
    `db-ivm/tests/incrementalization-law-oracle.property.test.ts`,
    `ivm`,
    `incrementalization-law-cells`,
  ],
  [
    `db-ivm/tests/structural-identity-oracle.property.test.ts`,
    `structural-identity`,
    `representation-fixed independent-values-fixed`,
  ],
  // react-db
  [
    `react-db/tests/convex-lazy-paging-oracle.test.tsx`,
    `react`,
    `convex-lazy-paging`,
  ],
  [
    `react-db/tests/effect-callback-oracle.test.tsx`,
    `react`,
    `effect-callback`,
  ],
  [
    `react-db/tests/usePacedMutations-render-cuts-oracle.test.tsx`,
    `react`,
    `paced-mutations-render-cuts`,
  ],
  [
    `react-db/tests/infinite-query-render-cuts-oracle.test.tsx`,
    `react`,
    `infinite-query-render-cuts.on-demand`,
  ],
  [
    `react-db/tests/infinite-query-render-cuts-oracle.test.tsx`,
    `react`,
    `infinite-query-render-cuts.sync-agreement`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `descriptor-abandoned-render-reader`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `descriptor-prebuilt-query-binding`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `ssr-ordinary-examples`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `ssr-infinite-examples`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `ssr-stream-cut-fixed`,
  ],
  // vue-db and scripts
]
