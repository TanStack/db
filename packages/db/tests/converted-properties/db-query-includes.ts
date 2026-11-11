// The oracleProperty ids that the declareOracle removal adds for the
// "db-query-includes" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  `includes-space.reachable-facades`,
  `includes-outer-join-route-work.main-correlation`,
  `evaluators.in-original-calibration`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `db/tests/query/includes-space-oracle.test.ts`,
    `includes-space`,
    `reachable-facades`,
  ],
  [
    `db/tests/query/includes-outer-join-route-work-oracle.test.ts`,
    `includes-outer-join-route-work`,
    `main-correlation`,
  ],
  [
    `db/tests/query/compiler/in-evaluator-oracle.property.test.ts`,
    `evaluators`,
    `in-original-calibration`,
  ],
]
