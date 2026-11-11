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
  `proxy.native-array-fixed-row`,
  `proxy.native-typed-fixed-row`,
  `proxy.native-typed-signed-zero`,
  `proxy.access-path-writes`,
  `proxy.stored-function-probes`,
  `proxy.define-property`,
  `proxy.frozen-nested-writes`,
  `proxy.revert-fixed-histories`,
  `proxy.revert-native-fixed-histories`,
  `flat-change-tracking.pinned`,
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
  [
    `db/tests/proxy-native-methods-oracle.property.test.ts`,
    `proxy`,
    `native-array-fixed-row native-typed-fixed-row native-typed-signed-zero`,
  ],
  [
    `db/tests/proxy-oracle.test.ts`,
    `proxy`,
    `access-path-writes stored-function-probes define-property frozen-nested-writes`,
  ],
  [
    `db/tests/proxy-revert-oracle.property.test.ts`,
    `proxy`,
    `revert-fixed-histories revert-native-fixed-histories`,
  ],
  [
    `db/tests/flat-change-tracking-oracle.property.test.ts`,
    `flat-change-tracking`,
    `pinned`,
  ],
]
