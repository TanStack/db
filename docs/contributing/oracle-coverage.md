# Oracle coverage and closeout

Use [Writing reliable oracle tests](oracle-tests.md) when adding or reviewing a
law. This map identifies existing owners, their judgment, and their limits. It
is not a claim that every state or every test has been audited.

## Scope of the oracle repair project

[Issue #1808](https://github.com/TanStack/db/issues/1808) commissioned a bounded
portfolio audit and repair. The September 11 inventory contained 329 tracked
paths: 132 selected/support entries and 197 discovery-tier files. The latter
received routing recommendations, not 197 full semantic reviews. Focused
examples, type tests, and host-wiring tests remain useful; converting them all
to generated tests is not a completion criterion.

[PR #1816](https://github.com/TanStack/db/pull/1816) preserves existing witnesses,
repairs false-green assertions and drivers, adds missing histories, and includes
narrow runtime fixes reproduced by the stronger tests. The later ten-area audit
found 59 actionable findings or optional suggestions: 46 repaired, one partly
repaired storage item, nine contract decisions, and three deferred suggestions.
These are **not counts of production bugs**. The earlier 13-item review is a
separate ledger, not another 13 unique defects.

## Find an owner

Paths below are relative to the repository root. Follow each suite's domain
comment and the current API/architecture contract before extending its model.

| Surface | Primary executable owners | Independent judgment and important limit |
| --- | --- | --- |
| Ordered relations and BTree | [top-K relation oracle](../../packages/db-ivm/tests/operators/topk-relation-oracle.test.ts), [BTree/Map](../../packages/db/tests/btree-map-oracle.test.ts), [incrementalization laws](../../packages/db-ivm/tests/incrementalization-law.property.test.ts) | Independent ordered relations and cumulative signed output. Top-K consolidation compares same-key values without hashing, including cyclic replacements and fresh transient cancellation. Other hash-based operators retain hashing's declared domain. Algebra does not specify client readiness. |
| Includes and publication | [cross-formulation](../../packages/db/tests/query/includes-cross-formulation-oracle.property.test.ts), [temporal](../../packages/db/tests/query/includes-temporal-oracle.test.ts), [Collection includes](../../packages/db/tests/query/includes-collection-oracle.property.test.ts), [architecture and complete suite map](../../packages/db/src/query/live/ARCHITECTURE.md#executable-contracts) | Per-parent/flat-join/partition relations, callback-time rows, nested values, and route histories. Observe raw promised order; fresh queries do not establish continuous publication safety. |
| Collection lifecycle | [history](../../packages/db/tests/collection-subscription-lifecycle-history.property.test.ts), [publication](../../packages/db/tests/collection-subscription-lifecycle-publication.property.test.ts), [replay](../../packages/db/tests/collection-subscription-replay-oracle.property.test.ts), [effect disposal](../../packages/db/tests/effect-disposal-oracle.test.ts) | Ownership and phase histories, exact caller/error/publication evidence, late completion and restart. Effect self-dependent disposal remains a separate contract question. |
| Optimistic state | [history model](../../packages/db/tests/optimistic-history-oracle.ts), [generated histories](../../packages/db/tests/optimistic-transaction-oracle.property.test.ts), [outcomes](../../packages/db/tests/optimistic-history-outcomes.test.ts), [publication](../../packages/db/tests/optimistic-history-publication.test.ts) | Independent whole-row snapshots, rollback dependencies, metadata and prior-value events. Never rebase a pending snapshot merely to simplify the model. |
| Drafts and native values | [proxy](../../packages/db/tests/proxy.test.ts), [detachment](../../packages/db/tests/proxy-detachment-contract.test.ts), [iteration](../../packages/db/tests/proxy-iteration-contract.test.ts) | Native-operation controls, exact patches and actual stored rows; alias/cycle/adversarial-key histories. General native-mutator and symbol-write support is not established by a plain-object oracle. |
| Query DB and observer | [ownership](../../packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts), [load lifecycle](../../packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts), [observer histories](../../packages/db/tests/live-query-observer-history.property.test.ts) | Real QueryClient boundary and a per-listener eligibility ledger, not a duplicate dispatch queue. Check reentry, peer survival, FIFO and disposal independently of final rows. |
| Ordered acquisition | [pagination](../../packages/db/tests/query/pagination-oracle.property.test.ts), [ordered work](../../packages/db/tests/query/ordered-work-oracle.property.test.ts), [ordered lifecycle](../../packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts) | Complete finite provider results, pending windows, ties/nulls, ownership and documented repair timing. Request completion is not proof of unrequested source extent. |
| Opaque backend pagination | [window oracle](../../packages/query-db-collection/tests/cursor-pagination.oracle.test.ts), [cache histories](../../packages/query-db-collection/tests/cursor-pagination.cache-oracle.test.ts), [cache publication](../../packages/query-db-collection/tests/cursor-pagination.publication-oracle.test.ts), [browser acquisition boundaries](../../packages/query-db-collection/tests/cursor-pagination.boundary-oracle.test.ts), [QueryCollection integration](../../packages/query-db-collection/tests/cursor-pagination.integration.test.ts) | Full filter/sort/slice reference, opaque token transport, actual Query cache expiry/invalidation/GC, forced refresh during growth, protocol failure publication/recovery, bounded slice work, nested cancellation/replacement, reader abort, browser retry defaults, manual-write cache isolation, and production window publications. Stable backend sequences; not snapshot guarantees for changing endpoints. Peek-ahead remains enabled. |
| Electric and TrailBase | [Electric histories](../../packages/electric-db-collection/tests/electric-oracle.property.test.ts), [PostgreSQL semantics](../../packages/electric-db-collection/e2e/sql-predicate-semantics.e2e.test.ts), [TrailBase contract](../../packages/trailbase-db-collection/tests/ORACLE.md) | Installed SDK delivery/framing, independent predicates, exact subscription arguments and late errors. SDK fixtures and a real service test earn different credit. |
| PowerSync | [tests](../../packages/powersync-db-collection/tests) | Applied receipt positions crossed with held peers, native SQLite/SDK and cleanup evidence. A timeout mutant proves a progress failure, not every value assertion. |
| SQLite persistence and native hosts | [persisted histories](../../packages/db-sqlite-persistence-core/tests/persisted.test.ts), [Browser composed-owner histories](../../packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts), [Browser coordinator RPC](../../packages/browser-db-sqlite-persistence/tests/browser-coordinator.test.ts), [Electron IPC and composed owner](../../packages/electron-db-sqlite-persistence/tests/electron-ipc.test.ts), [driver contracts](../../packages/db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract.ts), [113-law manifest](../../packages/db-collection-e2e/src/fixtures/persisted-conformance-manifest.ts) | Core cache/remote rejection/peer/reopen histories and exact driver results. Browser composes public source commits with per-collection elected-owner routing and covers the complete committed-transaction wire partition through deterministic Node transport seams. Remote-subset histories distinguish logical demand, physical acquisitions, exact acquisition leases, and released replay tombstones. Electron composes source commits with a per-collection renderer owner, IPC adapter, real SQLite, and reopen checks. The Browser seams are not real multi-context/OPFS-worker execution; the Electron harness is not an actual Electron process unless its explicit runtime-bridge mode runs. Registration-gated core remote demand and bounded host retry after transport/admission failure remain open review gaps. The manifest excludes progressive and move suites; registration and shim runs are not device execution. |
| Offline execution | [scheduler](../../packages/offline-transactions/tests/KeyScheduler.property.test.ts), [leadership](../../packages/offline-transactions/tests/leadership-replay.property.test.ts), [settlement](../../packages/offline-transactions/tests/transaction-settlement.property.test.ts), [serialization](../../packages/offline-transactions/tests/transaction-serializer.property.test.ts) | Declarative FIFO eligibility, per-transaction outcomes, durable state and typed wire trees. Issued work may finish after ownership loss, but new work must not start. Exactly-once network execution is not promised. |
| Frameworks | [React conformance](../../packages/react-db/tests/conformance.test.tsx), [React pagination](../../packages/react-db/tests/infinite-query-conformance.test.tsx), [shared suites](../../packages/db-collection-e2e/src/suites) | Exact exposed rows/pages and each framework's own lifecycle cuts. A React witness does not prove Vue/Solid/Angular/Svelte scheduling. Preserve their receiving registrations. |
| Small structures and test mechanics | [SortedMap](../../packages/db/tests/SortedMap.test.ts), [cleanup queue](../../packages/db/tests/cleanup-queue.property.test.ts), [guarded replay](../../packages/db/tests/oracle-replay.test.ts) | Map/full-sort and appointment-list models; executed target/seed/path checks. Callback-reentrant scheduling is outside the initial cleanup-queue domain. |

## Acceptance map

The post-merge review added three missing domains to existing owners:

- [Top-K batch contracts](../../packages/db-ivm/tests/operators/topk-batch-contract.test.ts)
  cross sparse-array length/holes and RegExp source/flags/position with equal
  controls, replacement order, hash consolidation, and actual retained graph
  output. Ordinary replacements also run without the global `File` constructor.
- [Leadership replay](../../packages/offline-transactions/tests/leadership-replay.property.test.ts)
  holds real storage-read delivery across successful and permanently rejected
  durable removals, with bounded scans, concurrent loads, and unfinished peers.
  This is distinct from exactly-once execution across independent owners.
- [Accepted-snapshot retention](../../packages/db/tests/collection-state-retention-oracle.property.test.ts)
  varies truncate before/during/after an optimistic delete, rejection versus
  rollback, post-capture direct insertion, and later ordinary sync/key reuse. A
  hidden accepted insert returns after rollback; an uncaptured insert retires,
  and neither snapshot is rebased onto synced fields.

| Issue obligation | Implemented evidence | Limit |
| --- | --- | --- |
| Metamorphic laws | Includes cross-formulation/partition, D2 independent-key commutation, DBSP incremental/full recomputation, pagination provider/UI boundaries, optimistic snapshot stability | Equivalence premises are explicit; not arbitrary query rewrites. |
| Public observations | Reads, exact event payloads and reconstructed state, observer eligibility, downstream includes, lifecycle and ownership checks | Count/work budgets are separate from row truth and only pin established promises. |
| Meaningful async histories | Applied receipts, truncate/replay, cleanup/restart, pending optimistic work, held provider completion, leadership loss | Control real causes; unsupported SDK traces receive no coverage credit. |
| Checker sensitivity | Faulty output controls, missing/duplicate events, stale completion/ownership controls, forced collisions and pre-fix runtime witnesses | Setup failures and timeouts are recorded separately from assertion kills. |
| Executed reach and replay | Named manifest with guarded replay, finite boundary products, pinned examples, fixed/random lanes and explicit stress runs | Root `test:oracles` is a selected core/Query DB campaign, not all repository oracles. |
| Contract and scope records | Guide, companion case notes, this map, suite-local law/domain comments and architecture | This is an executable testing method, not a completeness proof or new product specification. |

## Running and replaying

Build workspace dependencies before testing consumers of package exports. Use
the package's checked-in config; source aliases and native shims must be named
when they replace that path.

```sh
pnpm --filter @tanstack/db-ivm build
pnpm --filter @tanstack/db build
pnpm run typecheck:tests
pnpm exec tsc --noEmit -p packages/db/tsconfig.json
pnpm --dir packages/db exec vitest run --coverage.enabled=false --maxWorkers=2
pnpm --dir packages/db-ivm exec vitest run --coverage.enabled=false --maxWorkers=2
pnpm --dir packages/offline-transactions exec vitest run --maxWorkers=2
```

Core guarded replay is run from `packages/db`, for example:

```sh
TANSTACK_DB_ORACLE_SEED=1813 TANSTACK_DB_ORACLE_PATH=0 \
TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.granular-history \
node --import tsx tests/oracle-replay.ts \
  tests/live-query-observer-history.property.test.ts \
  -t 'granular listeners follow the eligibility ledger with a random or replayed seed' \
  --coverage.enabled=false --typecheck.enabled=false
```

Use the failure's actual seed/path for a reproduction. The example establishes
target execution, not reproduction of a particular bug. Local IVM and offline
properties have separate environment variables; inspect their test headers.
Do not assume the core multiplier reaches them.

Stress runs need an explicit file list, run budget, seed policy, runtime, exit
status and cost. For long synchronous campaigns, yield **between complete
histories**, never between an action and its synchronous observation. In this
project, worker progress RPC starvation produced passing assertions with a
nonzero process exit. Such a run is not green. Raising a test timeout alone
does not let the worker process its progress messages.

## Deferred contracts and evidence

The maintainer assigned offline policy work to
[RFC #1659](https://github.com/TanStack/db/issues/1659). It is not a merge blocker
for this oracle repair. Keep these scenarios and decisions with that owner:

- **A10 R7/R13:** provider succeeds, outbox deletion fails, then restart can replay
  the retained work. IndexedDB transaction-completion settlement is fixed here;
  LocalStorage's failure/read policy and post-success acknowledgment remain open.
- **A10 R4/R5/R9:** loss before durable admission, terminal waiter/removal/clear
  and restored optimistic lifetimes, and retry-hook failures.
- **A10 R11/R12 and earlier R8:** metadata/native-value domain, old readers of
  new wire records, and unreadable/unknown-version outbox recovery. New readers
  accepting old records does not prove reverse compatibility. Do not delete
  unreadable work silently or invent exactly-once guarantees.

Other explicit follow-up boundaries are owned by
[issue #1820](https://github.com/TanStack/db/issues/1820), not silently claimed
green:

- **Effect disposal:** the existing external-disposal wait and synchronous
  in-handler cancellation are tested. Waiting for independent work returned by
  the initiating handler conflicts with supporting a handler that awaits its
  own disposal. The candidate implementation was removed pending a contract.
- **Proxy native mutators and symbol writes:** retain supported standard
  Map/Set behavior. Decide additional support versus a clear error before
  generalizing expectations; do not silently drop native edits.
- **Progressive/native execution:** eight progressive registrations lack valid
  phase/capability evidence. Electric's ready gate is after application, not a
  pre-swap source gate; TrailBase does not supply that capability. The 24 move
  cases and actual native hosts need separate execution receipts. A green
  registration helper or package job does not prove these cells ran.
- **Optional mechanics/performance:** separating the expensive replay-process
  campaign, sharing native runner code only with both host builds verified,
  optional cancellation calibration and proxy construction-work budgets.
  An earlier suggestion to merge unnamed cleanup helpers still lacks exact
  targets; do not perform a blind consolidation.

## Final evidence record

Verification receipts and follow-up issue links are recorded in the PR and
the issue closeout comment. Keep their exact revision/runtime boundaries;
historical counts in research notes do not certify later commits. Closing the
bounded repair means the acceptance map has evidence and each remaining
question has an owner—not that there can be no more bugs.
