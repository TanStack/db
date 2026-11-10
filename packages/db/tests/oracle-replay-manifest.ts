import { registeredOracleProperties } from './oracle-config.js'

/**
 * This manifest maps a replay name to the source file that can prove it ran.
 * It is a named replay portfolio, not a catalog of every DB law. Enumerated
 * properties name a direct case campaign, without seed/path coordinates. Work
 * bounds, provider suites, and unnamed generated properties remain
 * separate campaign gates. An absent or statistics-only entry must not be
 * promoted to assertion evidence merely because a process exited cleanly.
 */
// Each group is [owner file, prefix, suffixes] and, when the owner runs the
// properties from another module, the module that names them.
// A property whose owner lives outside packages/ names it with a `../` prefix.
const ownerGroups: ReadonlyArray<
  readonly [string, string, string] | readonly [string, string, string, string]
> = [
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `persistence`,
    `crossed-leadership-index`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-options.test.ts`,
    `persisted-options.types`,
    `core-fixed`,
    `db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`,
  ],
  [
    `browser-db-sqlite-persistence/tests/persisted-options.test.ts`,
    `persisted-options.types`,
    `browser-fixed`,
    `db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`,
  ],
  [
    `db-sqlite-persistence-core/tests/reserved-commit-sqlite-adapter-oracle.test.ts`,
    `sqlite`,
    `reserved-commit-hydration`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-boolean-arity-oracle.test.ts`,
    `sqlite-persistence`,
    `boolean-arity-fixed`,
  ],
  [
    `browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts`,
    `opfs`,
    `page-lifecycle-fixed mixed-execute-fixed terminal-event-fixed close-fixed failure-cleanup-fixed`,
  ],
  [
    `browser-db-sqlite-persistence/tests/opfs-request-order-oracle.test.ts`,
    `opfs`,
    `request-order-fixed`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-readiness-oracle.test.ts`,
    `persisted-readiness`,
    `history`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-sync-problem-oracle.test.ts`,
    `persisted-sync-problem`,
    `history`,
  ],
  [
    `browser-db-sqlite-persistence/tests/opfs-worker-diagnostics-oracle.test.ts`,
    `opfs-worker`,
    `diagnostics-fixed`,
  ],
  [
    `browser-db-sqlite-persistence/tests/reload-class-oracle.test.ts`,
    `sqlite-reload`,
    `class-fixed`,
  ],
  [
    `electron-db-sqlite-persistence/tests/reload-class-oracle.test.ts`,
    `sqlite-reload`,
    `class.electron-fixed`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-reload-replacement-oracle.test.ts`,
    `persisted-reload-replacement`,
    `history`,
  ],
  [
    `db-sqlite-persistence-core/tests/shared-logical-scheduling-oracle.test.ts`,
    `sqlite-persistence`,
    `logical-scheduling`,
  ],
  [
    `db-ivm/tests/murmur-stream-oracle.property.test.ts`,
    `ivm`,
    `murmur-stream`,
  ],
  [
    `db-ivm/tests/operators/reduce-fast-path-oracle.property.test.ts`,
    `ivm`,
    `reduce-fast-path`,
  ],
  [
    `solid-db/tests/row-materialization-oracle.test.tsx`,
    `solid`,
    `row-materialization native-parent-materialization descriptor-visibility live-getters shared-graph-calibration shared-graphs callable-fields reserved-fields array-methods`,
  ],
  [
    `svelte-db/tests/cache-options-oracle.svelte.test.ts`,
    `svelte`,
    `cache-options`,
  ],
  [
    `svelte-db/tests/descriptor-start-release-oracle.svelte.test.ts`,
    `svelte`,
    `descriptor-start-release`,
  ],
  [
    `query-db-collection/tests/optimistic-ordered-refetch-oracle.test.ts`,
    `query`,
    `ordered-mutation-outcome`,
  ],
  [
    `convex-db-collection/e2e/backend-oracle.test.ts`,
    `convex.backend`,
    `insert update delete`,
  ],
  [
    `convex-db-collection/tests/values-oracle.property.test.ts`,
    `convex`,
    `values`,
  ],
  [
    `convex-db-collection/e2e/lazy-app-write-oracle.test.ts`,
    `convex`,
    `lazy-app`,
  ],
  [
    `convex-db-collection/e2e/lazy-boundary-oracle.test.ts`,
    `convex`,
    `boundary`,
  ],
  [
    `convex-db-collection/e2e/lazy-concurrency-oracle.test.ts`,
    `convex`,
    `backend-concurrency`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-abort-replay-oracle.property.test.ts`,
    `convex`,
    `abort-replay`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-failure-history-oracle.property.test.ts`,
    `convex`,
    `lazy-failure-history`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-history-oracle.property.test.ts`,
    `convex`,
    `lazy-history lazy-suffix lazy-retention-calibration`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-interleaving-oracle.property.test.ts`,
    `convex`,
    `lazy-interleaving`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-load-outcome-oracle.property.test.ts`,
    `convex`,
    `load-outcome`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-native-receipt-oracle.property.test.ts`,
    `convex`,
    `lazy-native-receipt`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-oracle.property.test.ts`,
    `convex`,
    `lazy-values lazy-work lazy-publication lazy-lifecycle lazy-receipt`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-receipt-oracle.property.test.ts`,
    `convex`,
    `lazy-exact-receipt`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-revalidation-oracle.property.test.ts`,
    `convex`,
    `revalidation`,
  ],
  [
    `convex-db-collection/tests/lazy-paging-version-oracle.property.test.ts`,
    `convex`,
    `lazy-version`,
  ],
  [
    `convex-db-collection/tests/offline-oracle.property.test.ts`,
    `convex`,
    `offline offline-source offline-acceptance`,
  ],
  [
    `convex-db-collection/tests/pagination-oracle.property.test.ts`,
    `convex`,
    `pagination-rows pagination-work pagination-bound`,
  ],
  [
    `convex-db-collection/tests/snapshot-oracle.property.test.ts`,
    `convex`,
    `snapshot`,
  ],
  [
    `convex-db-collection/tests/ownership-oracle.property.test.ts`,
    `convex`,
    `ownership`,
  ],
  [
    `browser-db-sqlite-persistence/tests/browser-coordinator-oracle.test.ts`,
    `browser-coordinator`,
    `mutation-delivery adapter-routing disposal collection-release retry-retention`,
  ],
  [
    `browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts`,
    `browser-coordinator`,
    `remote-lease routing`,
  ],
  [
    `browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts`,
    `browser`,
    `shared-driver-fairness`,
  ],

  [
    `../scripts/legacy-campaign-baseline-oracle.property.test.js`,
    `scripts`,
    `legacy-campaign-baseline`,
  ],
  [
    `db/tests/declared-reach-oracle.property.test.ts`,
    `oracle`,
    `declared-reach declared-reach-examples`,
  ],
  [
    `db/tests/query/pagination-oracle.property.test.ts`,
    `pagination`,
    `limit-admission-replay-pending-negative limit-admission-replay-pending-valid limit-admission-builder-negative limit-admission-builder-valid limit-admission-unstarted-negative limit-admission-unstarted-valid limit-admission-ready-negative limit-admission-ready-valid limit-admission-initial-pending-negative limit-admission-initial-pending-valid limit-admission-move-pending-negative limit-admission-move-pending-valid`,
    `db/tests/query/limit-admission-oracle.ts`,
  ],
  ...[
    [`react`, `react-db/tests/conformance.test.tsx`],
    [`react-dependency-list`, `react-db/tests/conformance.test.tsx`],
    [`preact`, `preact-db/tests/conformance.test.ts`],
    [`vue`, `vue-db/tests/conformance.test.ts`],
    [`solid`, `solid-db/tests/conformance.test.tsx`],
    [`angular`, `angular-db/tests/conformance.test.ts`],
    [`svelte`, `svelte-db/tests/conformance.svelte.test.ts`],
  ].map(
    ([driver, owner]) =>
      [
        owner!,
        `framework.${driver}`,
        `result-shape`,
        `db/tests/conformance/result-shape-oracle.ts`,
      ] as const,
  ),
  ...[
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
  ].map(
    ([driver, owner]) =>
      [
        owner!,
        `framework.${driver}`,
        `window-history pending-window-history publication-window-history peer-window-history`,
        `db/tests/conformance/window-history-oracle.ts`,
      ] as const,
  ),
  ...[
    [`react`, `react-db/tests/conformance.test.tsx`],
    [`react-dependency-list`, `react-db/tests/conformance.test.tsx`],
    [`react-DbClient`, `react-db/tests/conformance.test.tsx`],
    [`preact`, `preact-db/tests/conformance.test.ts`],
    [`svelte-DbClient`, `svelte-db/tests/conformance.svelte.test.ts`],
  ].map(
    ([driver, owner]) =>
      [
        owner!,
        `framework.${driver}`,
        `keyed-admission`,
        `db/tests/conformance/window-history-oracle.ts`,
      ] as const,
  ),
  [`react-db/tests/client-window-oracle.test.tsx`, `react`, `client-window`],
  ...[
    [`react`, `react-db/tests/conformance.test.tsx`],
    [`react-dependency-list`, `react-db/tests/conformance.test.tsx`],
    [`react-DbClient`, `react-db/tests/conformance.test.tsx`],
    [`react-Suspense`, `react-db/tests/conformance.test.tsx`],
    [`react-Suspense-DbClient`, `react-db/tests/conformance.test.tsx`],
    [`preact`, `preact-db/tests/conformance.test.ts`],
    [`svelte-DbClient`, `svelte-db/tests/conformance.svelte.test.ts`],
  ].map(
    ([driver, owner]) =>
      [
        owner!,
        `framework.${driver}`,
        `immutable-key-history`,
        `db/tests/conformance/window-history-oracle.ts`,
      ] as const,
  ),
  [
    `svelte-db/tests/client-window-oracle.svelte.test.ts`,
    `svelte`,
    `client-window client-window-recovery`,
  ],
  [
    `db/tests/live-query-observer-hydration-oracle.property.test.ts`,
    `live-query-observer`,
    `hydration-subset-handoff.granular hydration-subset-handoff.wholesale`,
  ],
  [
    `react-db/tests/window-render-oracle.test.tsx`,
    `react`,
    `window-render window-retry-ownership`,
  ],
  [
    `react-db/tests/suspense-lifecycle-oracle.test.tsx`,
    `react`,
    `suspense-retry-history suspense-replacement-history suspense-preload-restart-history suspense-siblings`,
  ],
  [
    `react-db/tests/bound-schema-options-oracle.test.tsx`,
    `react.bound-schema-options`,
    `live suspense`,
  ],
  [
    `react-db/tests/cache-options-oracle.test.tsx`,
    `react.cache-options`,
    `client-render suspense-render server-render`,
  ],
  [
    `react-db/tests/descriptor-start-release-oracle.test.tsx`,
    `react.descriptor-start-release`,
    `live infinite suspense`,
  ],
  [
    `react-db/tests/source-id-reuse-oracle.test.tsx`,
    `react`,
    `source-id-inline-options source-id-deferred-release`,
  ],
  [
    `react-db/tests/cache-first-registration-oracle.test.tsx`,
    `react`,
    `cache-first-registration`,
  ],
  [
    `react-db/tests/suspense-local-options-oracle.test.tsx`,
    `react`,
    `suspense-local-options`,
  ],
  [
    `react-db/tests/suspense-indexing-config-oracle.test.tsx`,
    `react`,
    `suspense-indexing-config`,
  ],
  [`preact-db/tests/bound-options-oracle.test.ts`, `preact`, `bound-options`],
  [
    `preact-db/tests/bound-schema-options-oracle.test.ts`,
    `preact`,
    `bound-schema-options`,
  ],
  [
    `preact-db/tests/window-render-oracle.test.tsx`,
    `preact`,
    [
      `window-render.eager-derived-offset`,
      `window-render.eager-derived-limit`,
      `window-render.eager-derived-both`,
      `window-render.eager-keyed-offset`,
      `window-render.eager-keyed-limit`,
      `window-render.eager-keyed-both`,
      `window-render.on-demand-derived-offset`,
      `window-render.on-demand-derived-limit`,
      `window-render.on-demand-derived-both`,
      `window-render.on-demand-keyed-offset`,
      `window-render.on-demand-keyed-limit`,
      `window-render.on-demand-keyed-both`,
    ].join(` `),
  ],
  [
    `react-db/tests/ssr-effects-oracle.test.ts`,
    `react`,
    [
      `ssr-effects-react18-ordinary-provider ssr-effects-react18-ordinary-explicit`,
      `ssr-effects-react18-suspense-provider ssr-effects-react18-suspense-explicit`,
      `ssr-effects-react18-standalone ssr-effects-react18-supplied`,
      `ssr-effects-current-ordinary-provider ssr-effects-current-ordinary-explicit`,
      `ssr-effects-current-suspense-provider ssr-effects-current-suspense-explicit`,
      `ssr-effects-current-standalone ssr-effects-current-supplied`,
      `ssr-effects-react18-disabled ssr-effects-current-disabled`,
    ].join(` `),
  ],
  [
    `../scripts/run-budget-oracle.property.test.js`,
    `scripts`,
    `run-budget run-budget-reexported run-budget-every-source run-budget-support-only`,
  ],
  [`../scripts/lint-scope-oracle.property.test.js`, `scripts`, `lint-scope`],
  [
    `../scripts/publish-history-oracle.property.test.js`,
    `scripts`,
    `publish-command`,
  ],
  [
    `../scripts/publish-http-oracle.property.test.js`,
    `scripts`,
    `publish-http`,
  ],
  [
    `../scripts/strip-oracle-probes-oracle.property.test.js`,
    `scripts`,
    `strip-oracle-probes`,
  ],
  [
    `../scripts/release-history-oracle.property.test.js`,
    `scripts`,
    `release-version release-seed-failure`,
  ],
  [
    `db/tests/ssr-stream-record-wait-oracle.test.ts`,
    `ssr`,
    `stream-record-lifetime`,
  ],
  [
    `db/tests/live-query-cache-lifecycle-oracle.test.ts`,
    `live-query`,
    `cache-claim-lifecycle`,
  ],
  [
    `db/tests/live-query-cache-options-oracle.test.ts`,
    `live-query`,
    `cache-option-admission`,
  ],
  [
    `db/tests/live-query-preload-indexing-oracle.test.ts`,
    `live-query`,
    `preload-indexing`,
  ],
  [
    `db/tests/live-query-deferred-acquisition-oracle.test.ts`,
    `live-query`,
    `start-handoff deferred-sibling`,
  ],
  [
    `db/tests/query/pooled-live-query-gc-oracle.test.ts`,
    `pooled-live-query`,
    `late-cleanup bootstrap-ownership cleanup-peers cleanup-admission`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `descriptor-error-surface descriptor-ownership ssr-ordinary ssr-infinite ssr-stream-cut`,
  ],
  [
    `react-db/tests/ssr-runtime-error-handoff-oracle.test.tsx`,
    `react`,
    `ssr-runtime-ordinary ssr-runtime-infinite ssr-runtime-ordinary.cases ssr-runtime-infinite.cases`,
  ],
  [
    `svelte-db/tests/ssr-snapshot-admission-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-snapshot ssr-snapshot.cases`,
  ],
  [
    `svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-handoff ssr-handoff.cases ssr-receiving-reader ssr-receiving-reader.cases`,
  ],
  [
    `svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-runtime-errors ssr-runtime-errors.cases`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-options.test.ts`,
    `persisted-options`,
    `types.core utilities.core`,
    `db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`,
  ],
  [
    `browser-db-sqlite-persistence/tests/persisted-options.test.ts`,
    `persisted-options`,
    `types.browser utilities.browser`,
    `db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`,
  ],
  [
    `db/tests/live-query-observer-snapshot-oracle.property.test.ts`,
    `live-query-observer`,
    `retained-snapshot snapshot-health row-container-sharing capture-paths record-shape sparse-array`,
  ],
  [
    `db/tests/cleanup-queue-oracle.property.test.ts`,
    `cleanup-queue`,
    `history`,
  ],
  [
    `db/tests/SortedMap-oracle.test.ts`,
    `sorted-map`,
    `key ascending descending regressions reach-calibration`,
  ],
  [
    `db/tests/replay-guard-calibration.fixture.test.ts`,
    `oracle-replay`,
    `calibration`,
  ],
  [
    `db/tests/replay-enumerated-oracle.fixture.test.ts`,
    `oracle-replay`,
    `enumerated-calibration enumerated-calibration-neighbor`,
  ],
  [
    `db-ivm/tests/structural-identity-oracle.property.test.ts`,
    `structural-identity`,
    `equal-representations independent-values`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `sqlite-persistence`,
    `source-fifo-order abort-graph owner-isolation open-transaction-boundary`,
  ],
  [
    `db/tests/optimistic-transaction-oracle.property.test.ts`,
    `collection-state`,
    `mixed-transaction same-key`,
  ],
  [
    `db/tests/index-update-oracle.property.test.ts`,
    `index-update`,
    `reference-model nullish-membership exact-identity custom-comparator`,
  ],
  [
    `db/tests/cursor-oracle.property.test.ts`,
    `cursor`,
    `scalar-continuation exact-width exact-local-order partial-width partial-local-order repeat-construction`,
  ],
  [
    `db/tests/optimistic-history-outcomes-oracle.test.ts`,
    `collection-state`,
    `optimistic-outcomes`,
  ],
  [
    `db/tests/query/ir-stable-identity-oracle.test.ts`,
    `ir-identity`,
    `canonical-expressions reference-expressions membership-set lexical-aliases projected-results output-denotation union-output-aliases reference-queries`,
  ],
  [
    `db/tests/query/identity-output-shape-oracle.test.ts`,
    `query-identity`,
    `compiled-output equality-partition`,
  ],
  [
    `trailbase-db-collection/tests/lifecycle-oracle.property.test.ts`,
    `trailbase`,
    `lifecycle`,
  ],
  [
    `electric-db-collection/tests/electric-descriptor-isolation-oracle.test.ts`,
    `electric`,
    `persisted-tag-history bound-descriptor-history`,
  ],
  [
    `electric-db-collection/tests/electric-oracle.property.test.ts`,
    `electric`,
    `match-reentry publication-epoch-convergence persistence-interleaving`,
  ],
  [
    `electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts`,
    `electric`,
    `sql-predicate-semantics`,
  ],
  [
    `electric-db-collection/tests/electric-recovery-oracle.test.ts`,
    `electric-recovery`,
    `publication-stream-convergence`,
  ],
  [
    `electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`,
    `electric`,
    `sdk-snapshot-delivery sdk-dnf-membership sdk-source-release sdk-rotation-release`,
  ],
  [
    `db/tests/collection-sync-reentrancy-oracle.test.ts`,
    `collection-sync`,
    `reentrant-drain`,
  ],
  [
    `db/tests/collection-gc-transaction-oracle.property.test.ts`,
    `collection-lifecycle`,
    `gc-persisting-transaction`,
  ],
  [
    `db/tests/collection-gc-mutation-oracle.property.test.ts`,
    `collection-lifecycle`,
    `gc-mutation-shapes`,
  ],
  [
    `db/tests/collection-state-retention-oracle.property.test.ts`,
    `collection-state`,
    `retention optimistic-history optimistic-history-partial accepted-snapshot.before-delete accepted-snapshot.during-delete accepted-snapshot.after-rollback`,
  ],
  [
    `db/tests/change-event-history-oracle.test.ts`,
    `collection-state`,
    `change-event-history eager-index-history`,
  ],
  [
    `db/tests/collection-metadata-publication-oracle.property.test.ts`,
    `collection-publication`,
    `metadata-only metadata-cancellation`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts`,
    `subscription-lifecycle`,
    `publication-history restart-publication`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-history-oracle.property.test.ts`,
    `subscription-lifecycle`,
    `history-statistics async-history constructed-history sync-history demand-change`,
  ],
  [
    `db/tests/source-health-oracle.test.ts`,
    `source-health`,
    `history required-history on-demand lazy-demand request-errors`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-oracle.test.ts`,
    `subscription-lifecycle`,
    `async-statistics async-restart notification-error`,
  ],
  [
    `db/tests/collection-subscription-replay-oracle.property.test.ts`,
    `subscription-replay`,
    `completion sequential restart same-tick shared optimistic`,
  ],
  [
    `db/tests/d2-source-reconciliation-oracle.property.test.ts`,
    `d2-source`,
    `exact-retractions changed-restart disjoint-commutation`,
  ],
  [
    `db/tests/query/cold-join-reconciliation-oracle.test.ts`,
    `cold-join`,
    `reconciliation compound`,
  ],
  [
    `db/tests/live-query-observer-history-oracle.property.test.ts`,
    `live-query-observer`,
    `granular-history wholesale-history partial-attach release-failure hydration-error-timing`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
    `sqlite-resume`,
    `startup-generation source-progress startup-corpus`,
  ],
  [
    `db/tests/query/compiler/group-by-pipeline-oracle.test.ts`,
    `compiler.group-by`,
    `batch`,
  ],
  [
    `db/tests/query/derived-delete-reconciliation-oracle.test.ts`,
    `derived-publication`,
    `membership-work membership-work-fixed`,
  ],
  [
    `db/tests/query/includes-collection-oracle.property.test.ts`,
    `includes-collection`,
    `relationship-history public-key-order layout-swap optimistic-child-history`,
  ],
  [
    `db/tests/query/includes-cross-formulation-oracle.property.test.ts`,
    `includes-cross-formulation`,
    `reference-context reference-key symbol-group-route equivalence ordered-window`,
  ],
  [
    `db/tests/query/includes-optimistic-oracle.property.test.ts`,
    `includes-optimistic`,
    `rekey-detach rekey-rollback descendant-rollback ancestor-rollback confirm-same-route confirm-different-route sibling-route-rollback repeated-history`,
  ],
  [
    `db/tests/query/includes-oracle.property.test.ts`,
    `includes`,
    `scenario-statistics incremental-history nested-scalar-materialization alpha-renaming scoped-alpha-renaming optimistic-convergence bucket-collisions`,
  ],
  [
    `db/tests/query/includes-query-shape-oracle.test.ts`,
    `includes-query-shape`,
    `correlation multiplicity nullable`,
  ],
  [
    `db/tests/query/includes-work-counter-oracle.test.ts`,
    `includes-work`,
    `correlated-links join-free join-targets projection-payload`,
  ],
  [
    `db/tests/query/includes-publication-oracle.test.ts`,
    `includes-publication`,
    `child-scalar parent-route atomic-parent-replacement optimistic-rollback`,
  ],
  [
    `db/tests/query/includes-temporal-oracle.test.ts`,
    `includes-temporal`,
    `demand-scheduling release-reentry partial-values`,
  ],
  [
    `db/tests/query/load-subset-joint-replay-oracle.property.test.ts`,
    `load-subset`,
    `joint-replay`,
  ],
  [
    `db/tests/query/load-subset-oracle.property.test.ts`,
    `load-subset`,
    `exact-completion exact-inflight rejected-waiter`,
  ],
  [
    `db/tests/query/ordered-lifecycle-oracle.property.test.ts`,
    `ordered-work`,
    `lifecycle nullable-lifecycle`,
  ],
  [
    `db/tests/query/ordered-work-oracle.property.test.ts`,
    `ordered-work`,
    `consumer-parity eager-indexed-window eager-joined-window eager-joined-gap eager-full-join eager-held-load eager-proven-report eager-unindexed-refetch`,
  ],
  [
    `db/tests/query/load-subset-replay-refinement-oracle.test.ts`,
    `replay`,
    `ordered-window-faults ordered-failed-replay ordered-preload-recovery keyed-request-failures subscription-demand-origin new-sibling-demand sibling-settlement-order subscription-error-order subscription-success-scope`,
  ],
  [
    `db/tests/query/pagination-oracle.property.test.ts`,
    `pagination`,
    `multi-order nullable-cursor pending-mutation pending-history ordered-window window-transition async-cursor`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `persistence`,
    `retained-demand`,
  ],
  // Owners of properties that a module names and a host file runs carry
  // that module as the fourth element.
  [
    `query-db-collection/tests/cursor-pagination.no-peek.test.ts`,
    `cursor-pagination`,
    `no-peek`,
  ],
  [
    `query-db-collection/tests/cursor-pagination.oracle.test.ts`,
    `cursor-pagination`,
    `history backend-ownership partition reset failure`,
  ],
  [
    `query-db-collection/tests/cursor-pagination.cache-oracle.test.ts`,
    `cursor-pagination`,
    `cache defaults cancellation`,
  ],
  [
    `query-db-collection/tests/cursor-pagination.boundary-oracle.test.ts`,
    `cursor-pagination`,
    `nested-cancellation reader-abort`,
  ],
  [
    `query-db-collection/tests/cursor-pagination-oracle.integration.test.ts`,
    `cursor-pagination`,
    `manual-write`,
  ],
  [
    `query-db-collection/tests/cursor-pagination.publication-oracle.test.ts`,
    `cursor-pagination`,
    `refresh-publication protocol-publication slice-work`,
  ],
  [
    `query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts`,
    `query-db`,
    `refetch-ordered-prefix refetch-held-page-end refetch-held-report`,
  ],
  [
    `db/tests/query/ordered-source-loader-state-oracle.test.ts`,
    `ordered-loader`,
    `request-authority unproven-report replay-continuation retirement-invalidation retirement-receiver`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-cli-runtime.test.ts`,
    `sqlite-persistence`,
    `binding-capacity binding-capacity.corpus binding-capacity.transaction binding-capacity.root-limit binding-capacity.scalar-stress`,
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-cli-runtime.test.ts`,
    `sqlite-resume`,
    `baseline-lineage baseline-lineage.external-metadata baseline-lineage.calibration`,
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
    `sqlite-ordinary`,
    `write-history independent-work`,
    `db-sqlite-persistence-core/tests/ordinary-transaction-work-oracle.ts`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `sqlite-persistence`,
    `request-local-failure-buffered-source`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `persistence`,
    `follower-remote-demand`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
    `persistence`,
    `generation-notice`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-optimistic-history-oracle.property.test.ts`,
    `sqlite-persistence`,
    `optimistic-history`,
  ],
  [
    `db-sqlite-persistence-core/tests/collection-setup-reopen-oracle.test.ts`,
    `sqlite-persistence`,
    `setup-reopen`,
  ],
  [
    `db/tests/mutation-handler-types-oracle.test.ts`,
    `adapter`,
    `handler-types`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
    `sqlite-resume`,
    `managed-claim-read managed-claim-read.cases retired-storage retired-storage.cases`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-demand-coverage-campaign-oracle.test.ts`,
    `persisted-demand-coverage`,
    `history required`,
  ],
  [
    `trailbase-db-collection/tests/lifecycle-oracle.property.test.ts`,
    `trailbase`,
    `page-event`,
  ],
  [
    `browser-db-sqlite-persistence/tests/reload-class-oracle.test.ts`,
    `sqlite-reload`,
    `class`,
  ],
  [
    `browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts`,
    `browser`,
    `multi-tab-reserved-history electric-source-prefix`,
  ],
  [
    `electron-db-sqlite-persistence/tests/reload-class-oracle.test.ts`,
    `sqlite-reload`,
    `class.electron`,
  ],
  [
    `db/tests/query/where-predicate-publication-oracle.property.test.ts`,
    `where-predicate`,
    `publication`,
  ],
  [
    `db/tests/query/custom-index-order-selection-oracle.test.ts`,
    `live-query`,
    `output-indexing`,
  ],
  [
    `db/tests/query/join-result-key-oracle.property.test.ts`,
    `join-result-key`,
    `pairs whole-source whole-source-matrix`,
  ],
  [
    `db/tests/query/public-container-copy-oracle.test.ts`,
    `query`,
    `public-container-copy`,
  ],
  [
    `db/tests/query/group-result-key-oracle.property.test.ts`,
    `group-result-key`,
    `groups`,
  ],
  [
    `db/tests/query/pooled-live-query-oracle.property.test.ts`,
    `pooled-live-query`,
    `publication`,
  ],
  [
    `db/tests/flat-change-tracking-oracle.property.test.ts`,
    `flat-change-tracking`,
    `equivalence`,
  ],
  [
    `db/tests/local-storage-value-fidelity-oracle.property.test.ts`,
    `local-storage`,
    `value-fidelity`,
  ],
  [`db/tests/local-storage-peers-oracle.test.ts`, `local-storage`, `peers`],
  [
    `db/tests/local-storage-write-order-oracle.test.ts`,
    `local-storage`,
    `write-order`,
  ],
  [
    `db/tests/query/bucket-facade-rollback-oracle.property.test.ts`,
    `bucket-facade`,
    `rollback-history`,
  ],
  [
    `db/tests/query/aggregate-select-oracle.property.test.ts`,
    `aggregate`,
    `select-shapes select-structural select-required`,
  ],
  [
    `db/tests/query/compiler/in-evaluator-oracle.property.test.ts`,
    `evaluators`,
    `in`,
  ],
  [
    `db/tests/transaction-ownership-oracle.property.test.ts`,
    `transaction-ownership`,
    `settlement-release`,
  ],
  [
    `db/tests/query/includes-work-counter-oracle.test.ts`,
    `includes-work`,
    `ordered-window`,
  ],
  [
    `db/tests/reverse-index-oracle.property.test.ts`,
    `reverse-index`,
    `reads large-reads`,
  ],
  [
    `db/tests/optimistic-history-oracle.property.test.ts`,
    `optimistic-history`,
    `core`,
  ],
  [
    `db/tests/live-query-observer-hydration-oracle.property.test.ts`,
    `live-query-observer`,
    `hydration-terminal`,
  ],
  [
    `db/tests/notification-laws-oracle.test.ts`,
    `notification-laws`,
    `query-publications publication-histories corrupt-prior-values`,
  ],
  [
    `db/tests/proxy-detachment-contract-oracle.test.ts`,
    `proxy`,
    `ordinary-field-copies json-data-keys`,
  ],
  [
    `db-ivm/tests/operators/topKWithFractionalIndex-oracle.test.ts`,
    `ivm`,
    `topk-cyclic-payloads-array topk-cyclic-payloads-grouped topk-outer-join-replacements-array topk-outer-join-replacements-grouped topk-fractional-keyed-array topk-fractional-keyed-grouped`,
  ],
  // Owners of the replays that moved to the shared variables.
  [
    `browser-db-sqlite-persistence/tests/opfs-worker-diagnostics-oracle.test.ts`,
    `opfs-worker`,
    `diagnostics`,
  ],
  [
    `db/tests/indexed-db/cross-tab-history-oracle.test.ts`,
    `indexeddb`,
    `cross-tab-history`,
  ],
  [`db/tests/proxy-oracle.test.ts`, `proxy`, `callback-history`],
  [
    `db/e2e/indexed-db/cross-tab-oracle.spec.ts`,
    `indexeddb`,
    `browser-native-history`,
  ],
  [
    `db/tests/indexed-db/pending-history-oracle.test.ts`,
    `indexeddb`,
    `pending-history`,
  ],
  [
    `db/tests/proxy-revert-oracle.property.test.ts`,
    `proxy`,
    `revert-history revert-signed-zero revert-nested-round-trips revert-class-writes revert-partial-reverts revert-native-histories`,
  ],
  [
    `db/tests/proxy-native-methods-oracle.property.test.ts`,
    `proxy`,
    `native-array-methods native-typed-methods`,
    `db/tests/proxy-native-methods-fixture.ts`,
  ],
  [
    `db-ivm/tests/hash-identity-oracle.property.test.ts`,
    `ivm`,
    `hash-identity hash-identity-cycles`,
  ],
  [
    `db-ivm/tests/multiset-consolidate-oracle.property.test.ts`,
    `ivm`,
    `multiset-consolidate`,
  ],
  [
    `electric-db-collection/tests/electric-oracle.property.test.ts`,
    `electric`,
    `adapter-failure-policy design-convergence durable-prefix initial-tagged-move-outs invalid-resume-partition metadata-merge-complete-state process-grammar source-ledger-calibration publication-before-persistence queued-presence-order resume-metadata-merge retry-decision subset-request-row-validity synthetic-batch-partition valid-batch-partition`,
  ],
  [
    `electric-db-collection/tests/pg-serializer-oracle.property.test.ts`,
    `pg-serializer`,
    `array-determinism bigint-round-trip bigint-text boolean-array-contents boolean-round-trip boolean-tokens date-iso date-round-trip double-round-trip integer-array-contents integer-array-format integer-round-trip integer-text mixed-array-contents nullish-array-contents scalar-determinism string-array-contents string-escaping string-idempotent string-passthrough`,
  ],
  [
    `electric-db-collection/tests/pg-serializer.test.ts`,
    `pg-serializer`,
    `nullish-empty`,
  ],
  [
    `db-ivm/tests/index-refinement-oracle.property.test.ts`,
    `ivm`,
    `index-refinement`,
  ],
  [
    `offline-transactions/tests/KeyScheduler-oracle.property.test.ts`,
    `offline`,
    `key-scheduler-fifo-ledger`,
  ],
  [
    `offline-transactions/tests/interruption-settlement-oracle.property.test.ts`,
    `offline`,
    `interruption-settlement`,
  ],
  [
    `offline-transactions/tests/interruption-settlement-oracle.property.test.ts`,
    `offline`,
    `disposal-handoff disposal-issued-handoff disposal-review-boundaries disposal-handoff-resources`,
    `offline-transactions/tests/interruption-handoff-oracle.ts`,
  ],
  [
    `offline-transactions/tests/interruption-settlement-oracle.property.test.ts`,
    `offline`,
    `settled-id-window`,
    `offline-transactions/tests/settled-id-window-oracle.ts`,
  ],
  [
    `offline-transactions/tests/interruption-settlement-oracle.property.test.ts`,
    `offline`,
    `executor-api executor-controls`,
    `offline-transactions/tests/executor-api-oracle.ts`,
  ],
  [
    `offline-transactions/tests/interruption-settlement-oracle.property.test.ts`,
    `offline`,
    `executor-coordination-lifecycle executor-connectivity-barrier`,
    `offline-transactions/tests/executor-lifecycle-oracle.ts`,
  ],
  [
    `query-db-collection/tests/offline-executor-refresh-oracle.test.ts`,
    `offline`,
    `executor-connectivity-query-db`,
  ],
  [
    `offline-transactions/tests/executor-environment-oracle.property.test.ts`,
    `offline`,
    `executor-environment`,
    `offline-transactions/tests/executor-environment-oracle.ts`,
  ],
  [
    `offline-transactions/tests/fifo-retry-oracle.property.test.ts`,
    `offline`,
    `fifo-retry`,
  ],
  [
    `offline-transactions/tests/leadership-replay-oracle.property.test.ts`,
    `offline`,
    `leadership.serial-work leadership.report leadership.delayed-read leadership.startup leadership.stale-read leadership.storage-failure`,
  ],
  [
    `offline-transactions/tests/transaction-serializer-oracle.property.test.ts`,
    `offline`,
    `serializer.mutation-wire serializer.date-marker serializer.version-two`,
    `offline-transactions/tests/transaction-serializer-oracle.ts`,
  ],
  [
    `offline-transactions/tests/transaction-serializer-oracle.property.test.ts`,
    `offline`,
    `serializer.malformed-object serializer.mutation-codec`,
  ],
  [
    `offline-transactions/tests/transaction-settlement-oracle.property.test.ts`,
    `offline`,
    `settlement.transaction settlement.retry-record settlement.admission settlement.retry-decision`,
  ],
  [
    `react-native-db-sqlite-persistence/tests/op-sqlite-driver-oracle.test.ts`,
    `op-sqlite`,
    `columnar-sql-aliases result-carrier-equivalence write-marker-aliases`,
  ],
  [
    `node-db-sqlite-persistence/tests/expression-index-oracle.test.ts`,
    `sqlite-persistence`,
    `expression-index bigint-roundtrip bigint-rejection expression-index.large-number expression-index.fixed-filter expression-index.native-identity expression-index.native-polarity`,
  ],
  [
    `browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts`,
    `opfs`,
    `page-lifecycle mixed-execute terminal-event close failure-cleanup`,
  ],
  [
    `browser-db-sqlite-persistence/tests/opfs-request-order-oracle.test.ts`,
    `opfs`,
    `request-order`,
  ],
  [
    `db-ivm/tests/hash-failure-retry-oracle.property.test.ts`,
    `ivm`,
    `hash-failure-retry`,
  ],
  [`db-ivm/tests/hash-graph-oracle.property.test.ts`, `ivm`, `hash-graph`],
  [
    `db-ivm/tests/hash-mixed-graph-oracle.property.test.ts`,
    `ivm`,
    `hash-mixed-graph`,
  ],
  [`db-ivm/tests/hash-oracle.property.test.ts`, `ivm`, `hash-value`],
  [
    `db-ivm/tests/incrementalization-law-oracle.property.test.ts`,
    `ivm`,
    `incrementalization-law`,
  ],
  [
    `db-ivm/tests/distinct-incrementalization-oracle.property.test.ts`,
    `ivm`,
    `distinct-collisions distinct-collisions-tuple`,
  ],
  [
    `db-ivm/tests/distinct-representative-oracle.property.test.ts`,
    `ivm`,
    `distinct-representatives distinct-representatives-unit-split`,
  ],
  [
    `db/tests/query/distinct-collision-oracle.test.ts`,
    `query`,
    `distinct-collisions distinct-collisions-ordered`,
  ],
  [
    `db-ivm/tests/operators/topk-batch-contract-oracle.test.ts`,
    `ivm`,
    `topk-batch-relations topk-batch-file-independent topk-batch-shared-subtrees topk-batch-unrelated-payloads topk-batch-long-cancellation`,
  ],
  [
    `db-ivm/tests/operators/topk-support-window-oracle.test.ts`,
    `ivm`,
    `topk-support-window topk-numeric-window topk-negative-window-array topk-negative-window-grouped topk-negative-window-orderBy`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-boolean-arity-oracle.test.ts`,
    `sqlite-persistence`,
    `boolean-arity`,
  ],
  [`db/tests/btree-map-oracle.test.ts`, `btree-map`, `history`],
  [
    `db/tests/indexed-db/persistence-oracle.test.ts`,
    `indexeddb`,
    `settled-history`,
  ],
  [`db/tests/query/compiler/evaluators-oracle.test.ts`, `evaluators`, `like`],
  [
    `db/tests/sync-metadata-session-oracle.property.test.ts`,
    `sync-metadata-session`,
    [
      `flat nested seeds seeds-full nested-seeds nested-conflicts`,
      `flat.hold-invariance nested.hold-invariance seeds.hold-invariance`,
      `seeds-full.hold-invariance nested-seeds.hold-invariance`,
      `nested-conflicts.hold-invariance flat.key-independence`,
      `nested.key-independence seeds.key-independence`,
      `nested-seeds.key-independence nested-conflicts.key-independence`,
      `seeds.seed-order nested-seeds.seed-order seeds-full.seed-order`,
    ].join(` `),
  ],
  [
    `db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts`,
    `sync-metadata-session`,
    `persisted-flat persisted-nested persisted-seeds persisted-conflicts persisted-cached persisted-nested-seeds persisted-reads persisted-reads-seeds persisted-peers persisted-peers-full persisted-peers-on-demand persisted-seed-reinsert-reload persisted-kept-metadata-durability persisted-queued-metadata-repair`,
  ],
  [
    `db-sqlite-persistence-core/tests/sync-metadata-session-sqlite.test.ts`,
    `sync-metadata-session`,
    `sqlite-seed-reinsert-reload sqlite-kept-metadata-durability`,
  ],
  [
    `db-sqlite-persistence-core/tests/sync-metadata-recovery.test.ts`,
    `sync-metadata-session`,
    `sqlite-recovery-schedules`,
  ],
  [
    `db-sqlite-persistence-core/tests/sync-metadata-missing-row.test.ts`,
    `sync-metadata-session`,
    `persisted-missing-row-metadata sqlite-missing-row-metadata`,
  ],
  [
    `db-adapter-conformance/tests/reference-adapter-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    [
      `reference reference.per-change reference.outage`,
      `reference.ablation.snapshot.first-ready reference.ablation.changes.change-batch`,
      `reference.ablation.fail.failure-after-ready reference.ablation.restart.restart`,
      `reference.ablation.wait.wait-before-evidence-fulfilled reference.ablation.disconnect.reconnect`,
      `reference.ablation.reconnect.reconnect reference.ablation.renew.renewal`,
      `reference.ablation.transient-failure.transient-failure-reported reference.ablation.changes.change-before-ready`,
      `reference.ablation.notes reference.ablation.live-values reference.ablation.read-point`,
    ].join(` `),
  ],
  [
    `db-adapter-conformance/tests/neon-realtime-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    `neon-realtime`,
  ],
  [
    `trailbase-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    `trailbase`,
  ],
  [
    `rxdb-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    `rxdb`,
  ],
  [
    `powersync-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    `powersync`,
  ],
  [
    `electric-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    `electric electric.no-on-error`,
  ],
  [
    `convex-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
    `adapter-conformance.eager-live-source`,
    `convex convex.react convex.wrapped`,
  ],
]

const owners = new Map<string, string>()
const sources = new Map<string, string>()
for (const [file, prefix, suffixes, source] of ownerGroups) {
  for (const suffix of suffixes.split(` `)) {
    const property = `${prefix}.${suffix}`
    if (owners.has(property))
      throw new Error(`duplicate replay owner: ${property}`)
    owners.set(property, `packages/${file}`)
    if (source !== undefined) sources.set(property, `packages/${source}`)
  }
}

// The sole computed caller: four laws × two Q1 shapes × four Q2 shapes.
// Reconciled with includes-publication-oracle.test.ts, not a prefix grep.
for (const law of [
  `parent-scalar`,
  `parent-then-child`,
  `optimistic-before-confirm`,
]) {
  for (const q1 of [`direct`, `joined`]) {
    for (const q2 of [`passThrough`, `where`, `orderBy`, `select`]) {
      owners.set(
        `includes-publication.${law}.${q1}.${q2}`,
        `packages/db/tests/query/includes-publication-oracle.test.ts`,
      )
    }
  }
}

owners.set(
  `collection-lifecycle.gc-retention-boundaries`,
  `packages/db/tests/collection-gc-retention-oracle.property.test.ts`,
)

for (const property of registeredOracleProperties) {
  if (property.startsWith(`includes.matrix.`)) {
    owners.set(
      property,
      `packages/db/tests/query/includes-oracle.property.test.ts`,
    )
  }
  if (property.startsWith(`utils.`)) {
    owners.set(property, `packages/db/tests/utils-oracle.property.test.ts`)
  }
  if (property.startsWith(`comparison.`)) {
    owners.set(property, `packages/db/tests/comparison-oracle.property.test.ts`)
  }
  if (property.startsWith(`pagination.matrix.`)) {
    owners.set(
      property,
      `packages/db/tests/query/pagination-oracle.property.test.ts`,
    )
  }
  if (property.startsWith(`electric.sdk-resume-checkpoint.`)) {
    owners.set(
      property,
      `packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`,
    )
  }
}

export type OracleReplayManifestEntry = {
  property: string
  /**
   * `browser-replay` names a Playwright owner. The guarded Vitest runner
   * cannot witness it, so it rejects the target. Replay it with `command`.
   * `reseeded-campaign` names a property whose generator has no shrink path. A
   * seed alone reproduces its history: `command` runs the owner directly
   * with TANSTACK_DB_ORACLE_SEED, which reseeds its random campaign. The
   * guarded runner, which witnesses a seed and path, rejects it.
   * `enumerated-campaign` names an oracleProperty with finite histories. Its
   * direct command selects that property's cases, calibrations and determinism
   * check. It takes no replay coordinates; the guarded runner rejects it.
   */
  status:
    | `assertion`
    | `statistics-only`
    | `browser-replay`
    | `reseeded-campaign`
    | `enumerated-campaign`
    | `no-named-owner`
  file?: string
  /** The module that names the property, when the owner file imports it. */
  source?: string
  cwd?: string
  command?: string
  testNamePattern?: string
  environment: ReadonlyArray<string>
}

// These patterns name the random/replay campaign, never its fixed-seed sibling.
// Pagination cells carry their property name in the test title so the guard
// can select one cell without running the rest of the matrix.
const replayTestNames = new Map([
  [`load-subset.joint-replay`, `load-subset\\.joint-replay > random seed`],
  [`evaluators.like`, `evaluators\\.like > random seed`],
  [`evaluators.in`, `evaluators\\.in > random seed`],
  ...[
    `aggregate.select-shapes`,
    `aggregate.select-required`,
    `pooled-live-query.bootstrap-ownership`,
    `pooled-live-query.cleanup-peers`,
    `pooled-live-query.late-cleanup`,
    `pooled-live-query.cleanup-admission`,
    `pooled-live-query.publication`,
    `join-result-key.pairs`,
    `join-result-key.whole-source`,
    `load-subset.exact-completion`,
    `load-subset.exact-inflight`,
    `load-subset.rejected-waiter`,
    `bucket-facade.rollback-history`,
    `where-predicate.publication`,
    `cold-join.reconciliation`,
    `cold-join.compound`,
    `ir-identity.canonical-expressions`,
    `ir-identity.reference-expressions`,
    `ir-identity.membership-set`,
    `ir-identity.lexical-aliases`,
    `ir-identity.projected-results`,
    `ir-identity.output-denotation`,
    `ir-identity.union-output-aliases`,
    `ir-identity.reference-queries`,
    `query.public-container-copy`,
    `query-identity.compiled-output`,
    `query-identity.equality-partition`,
    `derived-publication.membership-work`,
    `derived-publication.membership-work-fixed`,
    `query.distinct-collisions-ordered`,
  ].map(
    (property) =>
      [property, `${property.replaceAll(`.`, `\\.`)} > random seed`] as const,
  ),
  ...[
    `async-history`,
    `constructed-history`,
    `demand-change`,
    `sync-history`,
    `publication-history`,
    `restart-publication`,
  ].map(
    (name) =>
      [
        `subscription-lifecycle.${name}`,
        `subscription-lifecycle\\.${name} > random seed`,
      ] as const,
  ),
  [
    `electric.sql-predicate-semantics`,
    `electric\\.sql-predicate-semantics > random seed`,
  ],
  [`trailbase.lifecycle`, `trailbase\\.lifecycle > random seed`],
  [`trailbase.page-event`, `trailbase\\.page-event > random seed`],
  ...[...registeredOracleProperties]
    .filter((property) => property.startsWith(`electric.sdk-`))
    .map(
      (property) =>
        [property, `${property.replaceAll(`.`, `\\.`)} > random seed`] as const,
    ),
  [
    `electric-recovery.publication-stream-convergence`,
    `electric-recovery\\.publication-stream-convergence > random seed`,
  ],
  ...ownerGroups
    .filter(
      ([file]) =>
        file ===
        `electric-db-collection/tests/electric-oracle.property.test.ts`,
    )
    .flatMap(([, prefix, suffixes]) =>
      suffixes.split(` `).map((suffix) => {
        const property = `${prefix}.${suffix}`
        return [
          property,
          `${property.replaceAll(`.`, `\\.`)} > random seed`,
        ] as const
      }),
    ),
  ...ownerGroups
    .filter(([, prefix]) => prefix === `pg-serializer`)
    .flatMap(([, prefix, suffixes]) =>
      suffixes.split(` `).map((suffix) => {
        const property = `${prefix}.${suffix}`
        return [
          property,
          `${property.replaceAll(`.`, `\\.`)} > random seed`,
        ] as const
      }),
    ),
  ...[
    `electric.persisted-tag-history`,
    `electric.bound-descriptor-history`,
  ].map(
    (property) =>
      [property, `${property.replaceAll(`.`, `\\.`)} > random seed`] as const,
  ),
  [
    `sqlite-persistence.expression-index`,
    `sqlite-persistence\\.expression-index > random seed`,
  ],
  [
    `sqlite-persistence.bigint-roundtrip`,
    `sqlite-persistence\\.bigint-roundtrip > random seed`,
  ],
  [
    `sqlite-persistence.bigint-rejection`,
    `sqlite-persistence\\.bigint-rejection > random seed`,
  ],
  [
    `sqlite-resume.retired-storage`,
    `sqlite-resume\\.retired-storage > random seed`,
  ],
  [
    `sqlite-resume.managed-claim-read`,
    `sqlite-resume\\.managed-claim-read > random seed`,
  ],
  [
    `sqlite-resume.startup-generation`,
    `sqlite-resume\\.startup-generation > random seed`,
  ],
  [
    `sqlite-resume.baseline-lineage`,
    `sqlite-resume\\.baseline-lineage > random seed`,
  ],
  [
    `sqlite-persistence.binding-capacity`,
    `sqlite-persistence\\.binding-capacity > random seed`,
  ],
  [
    `scripts.legacy-campaign-baseline`,
    `scripts\\.legacy-campaign-baseline > random seed`,
  ],
  [`oracle.declared-reach`, `oracle\\.declared-reach > random seed`],
  ...ownerGroups
    .filter(([, prefix]) => prefix === `adapter-conformance.eager-live-source`)
    .flatMap(([, prefix, suffixes]) =>
      suffixes.split(` `).map((suffix) => {
        const property = `${prefix}.${suffix}`
        return [
          property,
          `${property.replaceAll(`.`, `\\.`)} > random seed`,
        ] as const
      }),
    ),
  [
    `query-db.refetch-held-page-end`,
    `query-db\\.refetch-held-page-end > random seed`,
  ],
  [
    `query-db.refetch-ordered-prefix`,
    `query-db\\.refetch-ordered-prefix > random seed`,
  ],
  [
    `query-db.refetch-held-report`,
    `query-db\\.refetch-held-report > random seed`,
  ],
  [`svelte.client-window`, `svelte\\.client-window > random seed`],
  [
    `svelte.client-window-recovery`,
    `svelte\\.client-window-recovery > random seed`,
  ],
  [
    `preact.window-render.eager-derived-offset`,
    `preact\\.window-render\\.eager-derived-offset > random seed`,
  ],
  [
    `preact.window-render.eager-derived-limit`,
    `preact\\.window-render\\.eager-derived-limit > random seed`,
  ],
  [
    `preact.window-render.eager-derived-both`,
    `preact\\.window-render\\.eager-derived-both > random seed`,
  ],
  [
    `preact.window-render.eager-keyed-offset`,
    `preact\\.window-render\\.eager-keyed-offset > random seed`,
  ],
  [
    `preact.window-render.eager-keyed-limit`,
    `preact\\.window-render\\.eager-keyed-limit > random seed`,
  ],
  [
    `preact.window-render.eager-keyed-both`,
    `preact\\.window-render\\.eager-keyed-both > random seed`,
  ],
  [
    `preact.window-render.on-demand-derived-offset`,
    `preact\\.window-render\\.on-demand-derived-offset > random seed`,
  ],
  [
    `preact.window-render.on-demand-derived-limit`,
    `preact\\.window-render\\.on-demand-derived-limit > random seed`,
  ],
  [
    `preact.window-render.on-demand-derived-both`,
    `preact\\.window-render\\.on-demand-derived-both > random seed`,
  ],
  [
    `preact.window-render.on-demand-keyed-offset`,
    `preact\\.window-render\\.on-demand-keyed-offset > random seed`,
  ],
  [
    `preact.window-render.on-demand-keyed-limit`,
    `preact\\.window-render\\.on-demand-keyed-limit > random seed`,
  ],
  [
    `preact.window-render.on-demand-keyed-both`,
    `preact\\.window-render\\.on-demand-keyed-both > random seed`,
  ],
  [`ivm.distinct-collisions`, `ivm\\.distinct-collisions > random seed`],
  [
    `ivm.distinct-representatives`,
    `ivm\\.distinct-representatives > random seed`,
  ],
  [
    `ivm.distinct-collisions-tuple`,
    `ivm\\.distinct-collisions-tuple > random seed`,
  ],
  [
    `ivm.distinct-representatives-unit-split`,
    `ivm\\.distinct-representatives-unit-split > random seed`,
  ],
  [`query.distinct-collisions`, `query\\.distinct-collisions > random seed`],
  [
    `sqlite-resume.source-progress`,
    `sqlite-resume\\.source-progress > random seed`,
  ],
  [
    `browser.electric-source-prefix`,
    `converges after interleaved source prefixes.*random or replayed`,
  ],
  [
    `collection-lifecycle.gc-mutation-shapes`,
    `retains every touched Collection across mutation shapes.*seed undefined`,
  ],
  [
    `collection-lifecycle.gc-retention-boundaries`,
    `preserves retention across transaction phases.*seed undefined`,
  ],
  [
    `subscription-lifecycle.notification-error`,
    `acquires retained demand after replacement readiness.*random`,
  ],
  [`svelte.ssr-snapshot`, `svelte\\.ssr-snapshot > random seed`],
  [`svelte.ssr-handoff`, `svelte\\.ssr-handoff > random seed`],
  [
    `svelte.ssr-receiving-reader`,
    `svelte\\.ssr-receiving-reader > random seed`,
  ],
  [`svelte.ssr-runtime-errors`, `svelte\\.ssr-runtime-errors > random seed`],
  [
    `structural-identity.equal-representations`,
    `structural-identity\\.equal-representations > random seed`,
  ],
  [
    `structural-identity.independent-values`,
    `structural-identity\\.independent-values > random seed`,
  ],
  [
    `index-update.reference-model`,
    `index-update\\.reference-model > random seed`,
  ],
  [
    `index-update.nullish-membership`,
    `index-update\\.nullish-membership > random seed`,
  ],
  [
    `index-update.exact-identity`,
    `index-update\\.exact-identity > random seed`,
  ],
  [
    `index-update.custom-comparator`,
    `index-update\\.custom-comparator > random seed`,
  ],
  [`ivm.hash-identity`, `ivm\\.hash-identity > random seed`],
  [`ivm.hash-identity-cycles`, `ivm\\.hash-identity-cycles > random seed`],
  [`ivm.hash-value`, `ivm\\.hash-value > random seed`],
  [`ivm.incrementalization-law`, `ivm\\.incrementalization-law > random seed`],
  [`ivm.topk-support-window`, `ivm\\.topk-support-window > random seed`],
  [`ivm.topk-numeric-window`, `ivm\\.topk-numeric-window > random seed`],
  [
    `ivm.topk-negative-window-array`,
    `ivm\\.topk-negative-window-array > random seed`,
  ],
  [
    `ivm.topk-negative-window-grouped`,
    `ivm\\.topk-negative-window-grouped > random seed`,
  ],
  [
    `ivm.topk-negative-window-orderBy`,
    `ivm\\.topk-negative-window-orderBy > random seed`,
  ],
  [
    `ivm.topk-cyclic-payloads-array`,
    `ivm\\.topk-cyclic-payloads-array > random seed`,
  ],
  [
    `ivm.topk-cyclic-payloads-grouped`,
    `ivm\\.topk-cyclic-payloads-grouped > random seed`,
  ],
  [
    `ivm.topk-outer-join-replacements-array`,
    `ivm\\.topk-outer-join-replacements-array > random seed`,
  ],
  [
    `ivm.topk-outer-join-replacements-grouped`,
    `ivm\\.topk-outer-join-replacements-grouped > random seed`,
  ],
  [
    `ivm.topk-fractional-keyed-array`,
    `ivm\\.topk-fractional-keyed-array > random seed`,
  ],
  [
    `ivm.topk-fractional-keyed-grouped`,
    `ivm\\.topk-fractional-keyed-grouped > random seed`,
  ],
  [`ivm.index-refinement`, `ivm\\.index-refinement > random seed`],
  [`ivm.murmur-stream`, `ivm\\.murmur-stream > random seed`],
  [`ivm.reduce-fast-path`, `ivm\\.reduce-fast-path > random seed`],
  [`group-result-key.groups`, `group-result-key\\.groups > random seed`],
])

// Properties whose own seeded generator replaces fast-check, so they have no
// shrink path.
const reseededProperties = new Set<string>()

// Enumerated oracleProperty sources have no random campaign or shrink path.
// Keep their literal registry names here; the owner groups still supply their
// receiving files and any shared source module.
const enumeratedProperties = new Set([
  `sqlite-persistence.expression-index.large-number`,
  `sqlite-persistence.expression-index.fixed-filter`,
  `sqlite-persistence.expression-index.native-identity`,
  `sqlite-persistence.expression-index.native-polarity`,
  `sqlite-resume.retired-storage.cases`,
  `sqlite-resume.managed-claim-read.cases`,
  `sqlite-resume.startup-corpus`,
  `sqlite-resume.baseline-lineage.external-metadata`,
  `sqlite-resume.baseline-lineage.calibration`,
  `sqlite-persistence.binding-capacity.corpus`,
  `sqlite-persistence.binding-capacity.transaction`,
  `sqlite-persistence.binding-capacity.root-limit`,
  `sqlite-persistence.binding-capacity.scalar-stress`,
  `solid.row-materialization`,
  `solid.native-parent-materialization`,
  `solid.descriptor-visibility`,
  `solid.live-getters`,
  `solid.shared-graph-calibration`,
  `solid.shared-graphs`,
  `solid.callable-fields`,
  `solid.reserved-fields`,
  `solid.array-methods`,
  `svelte.ssr-handoff.cases`,
  `svelte.ssr-receiving-reader.cases`,
  `svelte.ssr-snapshot.cases`,
  `svelte.ssr-runtime-errors.cases`,
  `svelte.cache-options`,
  `svelte.descriptor-start-release`,
  `query.ordered-mutation-outcome`,
  `oracle.declared-reach-examples`,
  `sorted-map.regressions`,
  `sorted-map.reach-calibration`,
  `scripts.release-version`,
  `scripts.release-seed-failure`,
  `scripts.publish-command`,
  `scripts.publish-http`,
  `reverse-index.large-reads`,
  `react.suspense-local-options`,
  `react.suspense-indexing-config`,
  `react.cache-first-registration`,
  `react.source-id-inline-options`,
  `react.source-id-deferred-release`,
  `react.ssr-effects-react18-disabled`,
  `react.ssr-effects-current-disabled`,
  `react.ssr-runtime-ordinary.cases`,
  `react.ssr-runtime-infinite.cases`,
  `react.descriptor-start-release.live`,
  `react.descriptor-start-release.infinite`,
  `react.descriptor-start-release.suspense`,
  `react.bound-schema-options.live`,
  `react.bound-schema-options.suspense`,
  `react.cache-options.client-render`,
  `react.cache-options.suspense-render`,
  `react.cache-options.server-render`,
  `preact.bound-options`,
  `preact.bound-schema-options`,
  `live-query.cache-claim-lifecycle`,
  `live-query.cache-option-admission`,
  `live-query.preload-indexing`,
  `live-query.deferred-sibling`,
  `oracle-replay.enumerated-calibration`,
  `oracle-replay.enumerated-calibration-neighbor`,
])

// These converted receivers register the framework's native campaign names.
// Their old hand-written campaign titles no longer select the random replay.
const nativeReactProperties = new Set([
  `react.client-window`,
  `react.window-render`,
  `react.window-retry-ownership`,
  `react.suspense-retry-history`,
  `react.suspense-replacement-history`,
  `react.suspense-preload-restart-history`,
  `react.suspense-siblings`,
  `react.descriptor-error-surface`,
  `react.descriptor-ownership`,
  `react.ssr-ordinary`,
  `react.ssr-infinite`,
  `react.ssr-stream-cut`,
  `react.ssr-runtime-ordinary`,
  `react.ssr-runtime-infinite`,
])

function directReplayTestName(property: string): string | undefined {
  if (
    property.startsWith(`browser-coordinator.`) ||
    [
      `browser.shared-driver-fairness`,
      `browser.electric-source-prefix`,
      `browser.multi-tab-reserved-history`,
    ].includes(property)
  )
    return `${property.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)} > random seed`

  // Includes registrations now use the framework's canonical campaign name.
  if (
    property.startsWith(`includes.matrix.`) ||
    property.startsWith(`includes-collection.`) ||
    property.startsWith(`includes-cross-formulation.`) ||
    property.startsWith(`includes-optimistic.`) ||
    property.startsWith(`includes-publication.`) ||
    property.startsWith(`includes-query-shape.`) ||
    property.startsWith(`includes-work.`) ||
    [
      `includes.alpha-renaming`,
      `includes.scoped-alpha-renaming`,
      `includes.incremental-history`,
      `includes.nested-scalar-materialization`,
      `includes.optimistic-convergence`,
      `includes.bucket-collisions`,
    ].includes(property)
  )
    return `${property.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)} > random seed`
  if (enumeratedProperties.has(property))
    return `${property.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)} > `
  if (property.startsWith(`pagination.limit-admission-`))
    return `${property.replaceAll(`.`, `\\.`)} > random seed`
  if (property.startsWith(`framework.`)) {
    switch (property.split(`.`).at(-1)) {
      case `result-shape`:
        return `result-shape > random seed`
      case `window-history`:
      case `pending-window-history`:
      case `publication-window-history`:
      case `peer-window-history`:
      case `keyed-admission`:
      case `immutable-key-history`:
        return `${property.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)} > random seed`
    }
  }
  if (
    nativeReactProperties.has(property) ||
    property.startsWith(`react.ssr-effects-`)
  )
    return `${property.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)} > random seed`
  if (
    [
      `replay.ordered-window-faults`,
      `replay.ordered-failed-replay`,
      `replay.ordered-preload-recovery`,
      `replay.keyed-request-failures`,
      `replay.subscription-demand-origin`,
    ].includes(property)
  )
    return `${property.replaceAll(`.`, `\\.`)} > random seed`
  if (property === `oracle-replay.calibration`)
    return `executes the replay calibration property`
  if (property.startsWith(`pagination.matrix.`))
    return `${property.replaceAll(`.`, `\\.`)} > random seed`
  return replayTestNames.get(property)
}

/**
 * The Vitest config for a directory outside packages/ whose config does not
 * have a default name. Its owners replay with `--config`.
 */
const outsideReplayConfigs = new Map([
  [`scripts`, `oracle-scripts.vitest.config.mjs`],
])

/**
 * An owner inside packages/ that its package's default config excludes, with
 * the config that runs it. The Neon receiving driver is expected RED, so it
 * runs only under its own config.
 */
const ownerReplayConfigs = new Map([
  [
    `packages/convex-db-collection/e2e/backend-oracle.test.ts`,
    `vitest.e2e.config.ts`,
  ],
  [
    `packages/convex-db-collection/e2e/lazy-app-write-oracle.test.ts`,
    `vitest.lazy.e2e.config.ts`,
  ],
  [
    `packages/convex-db-collection/e2e/lazy-boundary-oracle.test.ts`,
    `vitest.lazy.e2e.config.ts`,
  ],
  [
    `packages/convex-db-collection/e2e/lazy-concurrency-oracle.test.ts`,
    `vitest.lazy.e2e.config.ts`,
  ],
  [
    `packages/electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts`,
    `vitest.e2e.config.ts`,
  ],
  [
    `packages/db-adapter-conformance/tests/neon-realtime-oracle.property.test.ts`,
    `vitest.neon.config.ts`,
  ],
])

export const oracleReplayManifest: ReadonlyArray<OracleReplayManifestEntry> = [
  ...registeredOracleProperties,
].map((property) => {
  const file = owners.get(property)
  const status =
    file === undefined
      ? `no-named-owner`
      : file.endsWith(`.spec.ts`)
        ? `browser-replay`
        : reseededProperties.has(property)
          ? `reseeded-campaign`
          : enumeratedProperties.has(property)
            ? `enumerated-campaign`
            : property.endsWith(`-statistics`) ||
                property.endsWith(`.scenario-statistics`)
              ? `statistics-only`
              : `assertion`
  const outsidePackages = file?.startsWith(`packages/../`) === true
  // An owner outside packages/ replays from its own directory, with the
  // Vitest config that includes it there.
  const outsidePath = file?.slice(`packages/../`.length)
  const cwd = outsidePackages
    ? outsidePath!.slice(0, outsidePath!.lastIndexOf(`/`))
    : file?.split(`/`).slice(0, 2).join(`/`)
  const outsideConfig =
    cwd === undefined ? undefined : outsideReplayConfigs.get(cwd)
  const testNamePattern = directReplayTestName(property)
  const config = outsidePackages
    ? outsideConfig
    : file === undefined
      ? undefined
      : ownerReplayConfigs.get(file)
  return {
    property,
    status,
    file,
    ...(sources.has(property) ? { source: sources.get(property) } : {}),
    cwd,
    testNamePattern,
    command:
      file === undefined
        ? undefined
        : status === `browser-replay`
          ? `pnpm exec playwright test --config playwright.indexed-db.config.ts ${file.split(`/`).slice(2).join(`/`)}`
          : status === `reseeded-campaign`
            ? `pnpm exec vitest run ${file.split(`/`).slice(2).join(`/`)}`
            : status === `enumerated-campaign`
              ? `env -u TANSTACK_DB_ORACLE_SEED -u TANSTACK_DB_ORACLE_PATH -u TANSTACK_DB_ORACLE_PROPERTY pnpm exec vitest run ${config === undefined ? `` : `--config ${config} `}-t '${testNamePattern!.replaceAll(`'`, `'\\''`)}' ${outsidePackages ? file.split(`/`).pop() : file.split(`/`).slice(2).join(`/`)}`
              : outsidePackages
                ? `node --import tsx ${`../`.repeat(cwd!.split(`/`).length)}packages/db/tests/oracle-replay.ts ${outsideConfig === undefined ? `` : `--config ${outsideConfig} `}${file.split(`/`).pop()}`
                : `node --import tsx ${cwd === `packages/db` ? `tests` : `../db/tests`}/oracle-replay.ts ${ownerReplayConfigs.has(file) ? `--config ${ownerReplayConfigs.get(file)} ` : ``}${file.split(`/`).slice(2).join(`/`)}`,
    environment:
      status === `statistics-only`
        ? [
            `TANSTACK_DB_ORACLE_STATISTICS=1 (sampling only; no exact assertion replay)`,
          ]
        : status === `reseeded-campaign`
          ? [`TANSTACK_DB_ORACLE_SEED`]
          : status === `enumerated-campaign`
            ? []
            : [
                `TANSTACK_DB_ORACLE_SEED`,
                `TANSTACK_DB_ORACLE_PATH`,
                `TANSTACK_DB_ORACLE_PROPERTY`,
              ],
  }
})

for (const property of owners.keys()) {
  if (!registeredOracleProperties.has(property)) {
    throw new Error(`replay owner missing from registry: ${property}`)
  }
}
