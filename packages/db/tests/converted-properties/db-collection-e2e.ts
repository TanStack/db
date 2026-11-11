// The oracleProperty ids that the declareOracle removal adds for the
// "db-collection-e2e" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

// moves-oracle.suite.ts registers one enumerated property per sync mode.
export const properties: ReadonlyArray<string> = [
  `collection-e2e.moves.eager`,
  `collection-e2e.moves.on-demand`,
  `collection-e2e.moves.progressive`,
]

// Only electric.e2e.test.ts runs the move suite, under vitest.e2e.config.ts.
export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `electric-db-collection/e2e/electric.e2e.test.ts`,
    `collection-e2e.moves`,
    `eager on-demand progressive`,
    `db-collection-e2e/src/suites/moves-oracle.suite.ts`,
  ],
]
