// The oracleProperty ids that the declareOracle removal adds for the
// "db-core" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  // indexes and comparison
  // transactions and mutations
  // IndexedDB and live-query observers
  // proxies and conformance
  `proxy.own-property-histories`,
  `proxy.cycle-backedges`,
  `proxy.binary-detachment`,
  `proxy.iteration-array-edits`,
  `proxy.iteration-insertion-values`,
  `proxy.iteration-nested-membership`,
  `proxy.iteration-set-clear-readd`,
  `proxy.iteration-persisted-writes`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  // indexes and comparison
  // transactions and mutations
  // IndexedDB and live-query observers
  // proxies and conformance
  [
    `db/tests/proxy-detachment-contract-oracle.test.ts`,
    `proxy`,
    `own-property-histories cycle-backedges binary-detachment`,
  ],
  [
    `db/tests/proxy-iteration-contract-oracle.test.ts`,
    `proxy`,
    `iteration-array-edits iteration-insertion-values iteration-nested-membership iteration-set-clear-readd iteration-persisted-writes`,
  ],
]
