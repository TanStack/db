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
  // react-db
  `react.convex-lazy-paging`,
  `react.effect-callback`,
  `react.paced-mutations-render-cuts`,
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
  // vue-db and scripts
]
