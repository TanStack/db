// The enumerated oracleProperty ids, and their replay owners, of the
// "db-core" area: the properties that the declareOracle removal
// (2026-11-11) added. See index.ts.
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
  `index-suggestion.collection-size`,
  `index-suggestion.ordered-diagnostic`,
  `btree-map.split-comparator`,
  `btree-map.infinite-comparator`,
  `btree-map.long-campaign`,
  `btree-map.dense-cuts`,
  `comparison.non-finite-witnesses`,
  `comparison.signed-infinity-custom`,
  `comparison.temporal-witnesses`,
  `index-update.reference-model-fixed`,
  `index-update.nullish-fixed`,
  `index-update.nullish-string-owners`,
  `index-update.invalid-comparator`,
  `index-update.rejected-comparator-writes`,
  `index-update.collection-boundary`,
  `index-update.comparator-equal-update`,
  `index-update.mixed-key-deletion`,
  `index-update.mixed-key-history`,
  `index-update.temporal-key-owners`,
  `index-update.mixed-public-snapshot`,
  `index-update.binary-ownership`,
  `index-update.month-day-equality`,
  // transactions and mutations
  `collection-state.optimistic-composition`,
  `paced-mutations.timeline`,
  `paced-mutations.held-pacing`,
  `paced-mutations.settlement`,
  `collection-state.optimistic-outcome-cells`,
  `collection-state.pending-peer-settlement`,
  `collection-state.external-completion`,
  `collection-state.same-key-cases`,
  `collection-state.delete-insert`,
  `collection-state.typed-keys`,
  `optimistic-history.publication-cases`,
  `production-errors.classes`,
  `production-errors.sites`,
  `production-errors.generated-docs`,
  // IndexedDB and live-query observers
  `indexeddb.boundary-omission`,
  `indexeddb.boundary-receiver-overlap`,
  `indexeddb.boundary-obsolete-receiver`,
  `indexeddb.boundary-active-abort`,
  `indexeddb.boundary-imported-replacement`,
  `indexeddb.boundary-stale-peer`,
  `indexeddb.cross-tab-history-reconstruction`,
  `indexeddb.cross-tab-history-ordered-writes`,
  `indexeddb.manual-acceptance`,
  `indexeddb.retirement-admitted-pairs`,
  `indexeddb.retirement-accepted-publication`,
  `indexeddb.retirement-committed-continuation`,
  `indexeddb.retirement-mixed-prefixes`,
  `indexeddb.pending-history-reconstruction`,
  `indexeddb.pending-history-fixed`,
  `indexeddb.value-preservation`,
  `indexeddb.value-capture`,
  `indexeddb.transport-replacement`,
  `indexeddb.transport-unversioned-reconciliation`,
  `indexeddb.wrapper-observer-settlement`,
  `indexeddb.wrapper-request-error`,
  `indexeddb.local-write-order`,
  `live-query-observer.history-every-kind`,
  `live-query-observer.retained-snapshot-fixed`,
  `live-query-observer.capture-paths-discard`,
  `live-query-observer.capture-paths-retained`,
  `live-query.deferred-acquisition`,
  `live-query.deferred-pooled`,
  `live-query.deferred-cleanup-survivor`,
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
  [
    `db/tests/index-suggestion-oracle.test.ts`,
    `index-suggestion`,
    `collection-size ordered-diagnostic`,
  ],
  [
    `db/tests/btree-map-oracle.test.ts`,
    `btree-map`,
    `split-comparator infinite-comparator long-campaign dense-cuts`,
  ],
  [
    `db/tests/comparison-oracle.property.test.ts`,
    `comparison`,
    `non-finite-witnesses signed-infinity-custom temporal-witnesses`,
  ],
  [
    `db/tests/index-update-oracle.property.test.ts`,
    `index-update`,
    `reference-model-fixed nullish-fixed nullish-string-owners invalid-comparator rejected-comparator-writes collection-boundary comparator-equal-update mixed-key-deletion mixed-key-history temporal-key-owners mixed-public-snapshot binary-ownership month-day-equality`,
  ],
  // transactions and mutations
  [
    `db/tests/optimistic-composition-oracle.test.ts`,
    `collection-state`,
    `optimistic-composition`,
  ],
  [
    `db/tests/paced-mutations-oracle.test.ts`,
    `paced-mutations`,
    `timeline held-pacing settlement`,
  ],
  [
    `db/tests/optimistic-history-outcomes-oracle.test.ts`,
    `collection-state`,
    `optimistic-outcome-cells pending-peer-settlement external-completion`,
  ],
  [
    `db/tests/optimistic-transaction-oracle.property.test.ts`,
    `collection-state`,
    `same-key-cases delete-insert typed-keys`,
  ],
  [
    `db/tests/optimistic-history-publication-oracle.test.ts`,
    `optimistic-history`,
    `publication-cases`,
  ],
  [
    `db/tests/production-error-messages-oracle.test.ts`,
    `production-errors`,
    `classes sites generated-docs`,
  ],
  // IndexedDB and live-query observers
  [
    `db/tests/indexed-db/cross-tab-boundary-oracle.test.ts`,
    `indexeddb`,
    `boundary-omission boundary-receiver-overlap boundary-obsolete-receiver boundary-active-abort boundary-imported-replacement boundary-stale-peer`,
  ],
  [
    `db/tests/indexed-db/cross-tab-history-oracle.test.ts`,
    `indexeddb`,
    `cross-tab-history-reconstruction cross-tab-history-ordered-writes`,
  ],
  [
    `db/tests/indexed-db/persistence-oracle.test.ts`,
    `indexeddb`,
    `manual-acceptance`,
  ],
  [
    `db/tests/indexed-db/retirement-oracle.test.ts`,
    `indexeddb`,
    `retirement-admitted-pairs retirement-accepted-publication retirement-committed-continuation retirement-mixed-prefixes`,
  ],
  [
    `db/tests/indexed-db/pending-history-oracle.test.ts`,
    `indexeddb`,
    `pending-history-reconstruction pending-history-fixed`,
  ],
  [
    `db/tests/indexed-db/persistence-values-oracle.test.ts`,
    `indexeddb`,
    `value-preservation value-capture`,
  ],
  [
    `db/tests/indexed-db/transport-oracle.test.ts`,
    `indexeddb`,
    `transport-replacement transport-unversioned-reconciliation`,
  ],
  [
    `db/tests/indexed-db/wrapper-settlement-oracle.test.ts`,
    `indexeddb`,
    `wrapper-observer-settlement wrapper-request-error`,
  ],
  [
    `db/tests/indexed-db/local-write-order-oracle.test.ts`,
    `indexeddb`,
    `local-write-order`,
  ],
  [
    `db/tests/live-query-observer-history-oracle.property.test.ts`,
    `live-query-observer`,
    `history-every-kind`,
  ],
  [
    `db/tests/live-query-observer-snapshot-oracle.property.test.ts`,
    `live-query-observer`,
    `retained-snapshot-fixed capture-paths-discard capture-paths-retained`,
  ],
  [
    `db/tests/live-query-deferred-acquisition-oracle.test.ts`,
    `live-query`,
    `deferred-acquisition deferred-pooled deferred-cleanup-survivor`,
  ],
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
