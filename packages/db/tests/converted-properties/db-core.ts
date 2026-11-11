// The oracleProperty ids that the declareOracle removal adds for the
// "db-core" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

// The framework drivers that register the shared window-history oracle, with
// the test file that registers each (the same list as the replay manifest's
// window-history owners).
const windowHistoryDrivers = [
  [`react`, `react-db/tests/conformance.test.tsx`],
  [`react-dependency-list`, `react-db/tests/conformance.test.tsx`],
  [`react-DbClient`, `react-db/tests/conformance.test.tsx`],
  [`react-Suspense`, `react-db/tests/conformance.test.tsx`],
  [`react-Suspense-DbClient`, `react-db/tests/conformance.test.tsx`],
  [`preact`, `preact-db/tests/conformance.test.ts`],
  [`vue`, `vue-db/tests/conformance.test.ts`],
  [`solid`, `solid-db/tests/conformance.test.tsx`],
  [`angular`, `angular-db/tests/conformance.test.ts`],
  [`svelte`, `svelte-db/tests/conformance.svelte.test.ts`],
  [`svelte-DbClient`, `svelte-db/tests/conformance.svelte.test.ts`],
] as const

export const properties: ReadonlyArray<string> = [
  // indexes and comparison
  `cursor.scalar-matrix`,
  `cursor.composite-width-matrix`,
  `cursor.leading-boundary-matrix`,
  `cursor.local-order-fixed`,
  `duration-query-equality.direct-lookup`,
  `duration-query-equality.public-eq`,
  `duration-query-equality.calendar-indexing`,
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
  ...windowHistoryDrivers.map(
    ([driver]) => `framework.${driver}.window-history-fixed`,
  ),
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  // indexes and comparison
  [
    `db/tests/cursor-oracle.property.test.ts`,
    `cursor`,
    `scalar-matrix composite-width-matrix leading-boundary-matrix local-order-fixed`,
  ],
  [
    `db/tests/duration-query-equality-oracle.test.ts`,
    `duration-query-equality`,
    `direct-lookup public-eq calendar-indexing`,
  ],
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
  ...windowHistoryDrivers.map(
    ([driver, owner]) =>
      [
        owner,
        `framework.${driver}`,
        `window-history-fixed`,
        `db/tests/conformance/window-history-oracle.ts`,
      ] as const,
  ),
]
