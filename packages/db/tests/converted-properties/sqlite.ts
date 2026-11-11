// The oracleProperty ids that the declareOracle removal adds for the
// "sqlite" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [`opfs.open-outcome`]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `browser-db-sqlite-persistence/tests/opfs-open-outcome-oracle.test.ts`,
    `opfs`,
    `open-outcome`,
  ],
]
