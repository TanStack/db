import { registeredOracleProperties } from './oracle-config.js'

/**
 * This manifest maps a replay name to the source file that can prove it ran.
 * It is a named replay portfolio, not a catalog of every DB law. Fixed cases,
 * work bounds, provider suites, and unnamed generated properties remain
 * separate campaign gates. An absent or statistics-only entry must not be
 * promoted to assertion evidence merely because a process exited cleanly.
 */
// Each group is [owner file, prefix, suffixes] and, when the owner runs the
// properties from another module, the module that names them.
const ownerGroups: ReadonlyArray<
  readonly [string, string, string] | readonly [string, string, string, string]
> = [
  [
    `db/tests/ssr-stream-record-wait-oracle.test.ts`,
    `ssr`,
    `stream-record-lifetime`,
  ],
  [
    `db/tests/live-query-deferred-acquisition-oracle.test.ts`,
    `live-query`,
    `start-handoff`,
  ],
  [
    `db/tests/query/pooled-live-query-gc-oracle.test.ts`,
    `pooled-live-query`,
    `late-cleanup bootstrap-ownership cleanup-peers`,
  ],
  [
    `react-db/tests/descriptor-query-binding-oracle.test.tsx`,
    `react`,
    `descriptor-error-surface descriptor-ownership ssr-ordinary ssr-infinite ssr-stream-cut`,
  ],
  [
    `react-db/tests/ssr-runtime-error-handoff-oracle.test.tsx`,
    `react`,
    `ssr-runtime-ordinary ssr-runtime-infinite`,
  ],
  [
    `svelte-db/tests/ssr-snapshot-admission-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-snapshot`,
  ],
  [
    `svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-handoff ssr-receiving-reader`,
  ],
  [
    `svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts`,
    `svelte`,
    `ssr-runtime-errors`,
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
    `retained-snapshot`,
  ],
  [
    `db/tests/cleanup-queue-oracle.property.test.ts`,
    `cleanup-queue`,
    `history`,
  ],
  [
    `db/tests/SortedMap-oracle.test.ts`,
    `sorted-map`,
    `key ascending descending`,
  ],
  [
    `db/tests/replay-guard-calibration.fixture.test.ts`,
    `oracle-replay`,
    `calibration`,
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
    `publication-history`,
  ],
  [
    `db/tests/collection-subscription-lifecycle-history-oracle.property.test.ts`,
    `subscription-lifecycle`,
    `history-statistics async-history sync-history`,
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
    `startup-generation`,
  ],
  [
    `db/tests/query/derived-delete-reconciliation-oracle.test.ts`,
    `derived-publication`,
    `membership-work`,
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
    `scenario-statistics incremental-history nested-scalar-materialization alpha-renaming scoped-alpha-renaming optimistic-convergence`,
  ],
  [
    `db/tests/query/includes-query-shape-oracle.test.ts`,
    `includes-query-shape`,
    `correlation multiplicity nullable`,
  ],
  [
    `db/tests/query/includes-work-counter-oracle.test.ts`,
    `includes-work`,
    `correlated-links join-free join-targets`,
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
    `ordered-window-faults ordered-failed-replay ordered-preload-recovery keyed-request-failures subscription-demand-origin`,
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
    `refetch-ordered-prefix`,
  ],
  [
    `db/tests/query/ordered-source-loader-state-oracle.test.ts`,
    `ordered-loader`,
    `request-authority unproven-report`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-cli-runtime.test.ts`,
    `sqlite-persistence`,
    `binding-capacity`,
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-core-adapter-cli-runtime.test.ts`,
    `sqlite-resume`,
    `baseline-lineage`,
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
    `generation-notice follower-remote-demand`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-optimistic-history.test.ts`,
    `sqlite-persistence`,
    `optimistic-history`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
    `sqlite-resume`,
    `managed-claim-read retired-storage`,
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
    `db/tests/query/join-result-key-oracle.property.test.ts`,
    `join-result-key`,
    `pairs`,
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
  [
    `db/tests/query/bucket-facade-rollback-oracle.property.test.ts`,
    `bucket-facade`,
    `rollback-history`,
  ],
  [
    `db/tests/query/aggregate-select-oracle.property.test.ts`,
    `aggregate`,
    `select-shapes`,
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
  [`db/tests/reverse-index-oracle.property.test.ts`, `reverse-index`, `reads`],
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
    `revert-history revert-nested-round-trips revert-class-writes revert-partial-reverts revert-native-histories`,
  ],
  [
    `db/tests/proxy-native-methods-oracle.property.test.ts`,
    `proxy`,
    `native-array-methods native-typed-methods`,
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
    `adapter-failure-policy design-convergence durable-prefix initial-tagged-move-outs invalid-resume-partition metadata-merge-complete-state process-grammar publication-before-persistence queued-presence-order resume-metadata-merge retry-decision subset-request-row-validity synthetic-batch-partition valid-batch-partition`,
  ],
  [
    `electric-db-collection/tests/pg-serializer-oracle.property.test.ts`,
    `pg-serializer`,
    `array-determinism bigint-round-trip bigint-text boolean-array-contents boolean-round-trip boolean-tokens date-iso date-round-trip double-round-trip integer-array-contents integer-array-format integer-round-trip integer-text mixed-array-contents nullish-array-contents nullish-empty scalar-determinism string-array-contents string-escaping string-idempotent string-passthrough`,
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
    `expression-index bigint-roundtrip bigint-rejection`,
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
    `db-ivm/tests/operators/topk-support-window-oracle.test.ts`,
    `ivm`,
    `topk-support-window`,
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
}

export type OracleReplayManifestEntry = {
  property: string
  /**
   * `browser-replay` names a Playwright owner. The guarded Vitest runner
   * cannot witness it, so it rejects the target. Replay it with `command`.
   * `seed-replay` names a property whose generator has no shrink path. A
   * seed alone reproduces its history: `command` runs the owner directly
   * with TANSTACK_DB_ORACLE_SEED, which reseeds its random campaign. The
   * guarded runner, which witnesses a seed and path, rejects it.
   */
  status:
    | `assertion`
    | `statistics-only`
    | `browser-replay`
    | `seed-replay`
    | `no-named-owner`
  file?: string
  /** The module that names the property, when the owner file imports it. */
  source?: string
  cwd?: string
  command?: string
  testNamePattern?: string
  environment: ReadonlyArray<string>
}

// These patterns name the random/replay lane, never its fixed-seed sibling.
// Pagination cells carry their property name in the test title so the guard
// can select one cell without running the rest of the matrix.
const replayTestNames = new Map([
  [
    `collection-lifecycle.gc-mutation-shapes`,
    `retains every touched Collection across mutation shapes.*seed undefined`,
  ],
  [
    `collection-lifecycle.gc-persisting-transaction`,
    `retires a Collection only after gcTime.*seed undefined`,
  ],
  [
    `collection-lifecycle.gc-retention-boundaries`,
    `preserves retention across transaction phases.*seed undefined`,
  ],
  [
    `ssr.stream-record-lifetime`,
    `settles each record demand at its transport checkpoint.*random`,
  ],
  [
    `live-query-observer.hydration-error-timing`,
    `publishes errors at their ownership checkpoint.*random`,
  ],
  [
    `live-query-observer.retained-snapshot`,
    `first reads match the capture-time rows.*random`,
  ],
  [`live-query.start-handoff`, `reports only its own thrown starts.*random`],
  [
    `pooled-live-query.late-cleanup`,
    `releases late cleanup registration channels.*random`,
  ],
  [
    `pooled-live-query.bootstrap-ownership`,
    `bootstrap ownership after callback failure.*random`,
  ],
  [
    `pooled-live-query.cleanup-peers`,
    `cleanup status reaches every observer.*random`,
  ],
  [
    `live-query-observer.partial-attach`,
    `releases every acquired channel before retry.*random`,
  ],
  [
    `subscription-lifecycle.notification-error`,
    `acquires retained demand after replacement readiness.*random`,
  ],
  [
    `react.descriptor-error-surface`,
    `error-surface after descriptor failure.*random`,
  ],
  [`react.descriptor-ownership`, `ownership after descriptor failure.*random`],
  [`react.ssr-ordinary`, `ordinary admits reproducible SSR snapshots.*random`],
  [`react.ssr-infinite`, `infinite admits reproducible SSR snapshots.*random`],
  [`react.ssr-stream-cut`, `transports the rendered view.*random`],
  [
    `react.ssr-runtime-ordinary`,
    `ordinary preserves runtime error hydration views.*random`,
  ],
  [
    `react.ssr-runtime-infinite`,
    `infinite preserves runtime error hydration views.*random`,
  ],
  [`svelte.ssr-snapshot`, `admits reproducible SSR snapshots.*random`],
  [`svelte.ssr-handoff`, `matches the actual browser initialization.*random`],
  [
    `svelte.ssr-receiving-reader`,
    `preserves each receiving reader view.*random`,
  ],
  [
    `svelte.ssr-runtime-errors`,
    `keeps runtime failures on their ordinary error surface.*random`,
  ],
  [
    `live-query-observer.release-failure`,
    `reattaches after reporting a release failure.*random`,
  ],
  [
    `structural-identity.equal-representations`,
    `agrees with D2 value identity for equal representations`,
  ],
  [
    `structural-identity.independent-values`,
    `agrees with D2 value identity for independent values`,
  ],
  [
    `index-update.reference-model`,
    `matches a reference model across valid operation sequences \\(seed undefined\\)`,
  ],
  [
    `index-update.nullish-membership`,
    `refines nullish membership histories \\(seed undefined\\)`,
  ],
  [
    `index-update.exact-identity`,
    `preserves exact equality while ordered traversal retains every row \\(seed undefined\\)`,
  ],
  [
    `index-update.custom-comparator`,
    `matches an independent custom-comparator model \\(seed undefined\\)`,
  ],
  [
    `group-result-key.groups`,
    `publishes one key of the key type per group \\(seed undefined\\)`,
  ],
])

// Properties whose own seeded generator replaces fast-check, so they have no
// shrink path.
const seedReplayProperties = new Set([`evaluators.like`])

function directReplayTestName(property: string): string | undefined {
  if (property === `replay.ordered-window-faults`)
    return `keeps the ordered window under load and release faults \\(replay campaign\\)`
  if (property === `replay.ordered-failed-replay`)
    return `keeps the last publication through a failed replay \\(replay campaign\\)`
  if (property === `replay.ordered-preload-recovery`)
    return `recovers replays that start during the initial preload \\(replay campaign\\)`
  if (property === `replay.keyed-request-failures`)
    return `distinguishes keyed request failure from reacquisition \\(replay campaign\\)`
  if (property === `replay.subscription-demand-origin`)
    return `distinguishes failed demand origins \\(replay campaign\\)`
  if (property === `cold-join.compound`)
    return `recomputes generated compound histories, seed=undefined`
  if (property === `oracle-replay.calibration`)
    return `executes the replay calibration property`
  if (property.startsWith(`pagination.matrix.`))
    return `\\[${property.replaceAll(`.`, `\\.`)}\\]`
  return replayTestNames.get(property)
}

export const oracleReplayManifest: ReadonlyArray<OracleReplayManifestEntry> = [
  ...registeredOracleProperties,
].map((property) => {
  const file = owners.get(property)
  const status =
    file === undefined
      ? `no-named-owner`
      : file.endsWith(`.spec.ts`)
        ? `browser-replay`
        : seedReplayProperties.has(property)
          ? `seed-replay`
          : property.endsWith(`-statistics`) ||
              property.endsWith(`.scenario-statistics`)
            ? `statistics-only`
            : `assertion`
  const cwd = file?.split(`/`).slice(0, 2).join(`/`)
  return {
    property,
    status,
    file,
    ...(sources.has(property) ? { source: sources.get(property) } : {}),
    cwd,
    testNamePattern: directReplayTestName(property),
    command:
      file === undefined
        ? undefined
        : status === `browser-replay`
          ? `pnpm exec playwright test --config playwright.indexed-db.config.ts ${file.split(`/`).slice(2).join(`/`)}`
          : status === `seed-replay`
            ? `pnpm exec vitest run ${file.split(`/`).slice(2).join(`/`)}`
            : `node --import tsx ${cwd === `packages/db` ? `tests` : `../db/tests`}/oracle-replay.ts ${file.split(`/`).slice(2).join(`/`)}`,
    environment:
      status === `statistics-only`
        ? [
            `TANSTACK_DB_ORACLE_STATISTICS=1 (sampling only; no exact assertion replay)`,
          ]
        : status === `seed-replay`
          ? [`TANSTACK_DB_ORACLE_SEED`]
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
