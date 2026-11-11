// The oracleProperty ids that the declareOracle removal adds for the
// "sqlite" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  `opfs.open-outcome`,
  `electron.ipc-readiness`,
  `electron.follower-settlement`,
  `sqlite-reload.class.electron-app`,
  `sqlite-persistence.typed-value-reopen`,
  `sqlite-persistence.native-temporal-query`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `browser-db-sqlite-persistence/tests/opfs-open-outcome-oracle.test.ts`,
    `opfs`,
    `open-outcome`,
  ],
  [
    `electron-db-sqlite-persistence/tests/electron-ipc-readiness-oracle.test.ts`,
    `electron`,
    `ipc-readiness follower-settlement`,
  ],
  [
    `electron-db-sqlite-persistence/tests/reload-class-oracle.electron.e2e.test.ts`,
    `sqlite-reload`,
    `class.electron-app`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-temporal-value-oracle.test.ts`,
    `sqlite-persistence`,
    `typed-value-reopen native-temporal-query`,
  ],
]
