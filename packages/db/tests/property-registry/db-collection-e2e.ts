// The enumerated oracleProperty ids, and their replay owners, of the
// "db-collection-e2e" area: the properties that the declareOracle removal
// (2026-11-11) added. See index.ts.
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
