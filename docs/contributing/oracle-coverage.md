# Oracle coverage and closeout

Use [Writing reliable oracle tests](oracle-tests.md) when adding or reviewing a
law. This map identifies existing owners, their judgment, and their limits. It
is not a claim that every state or every test has been audited.

The [project glossary](glossary.md) owns terms shared by these executable
models and their production subsystems. A coverage owner may define narrower
local terms, but it must not silently rename a production concept.

## Scope of the oracle repair project

[Issue #1808](https://github.com/TanStack/db/issues/1808) commissioned a bounded
portfolio audit and repair. The September 11 inventory contained 329 tracked
paths: 132 selected/support entries and 197 discovery-tier files. The latter
received routing recommendations, not 197 full semantic reviews. Focused
examples, type tests, and host-wiring tests remain useful; converting them all
to generated tests is not a completion criterion.

## Literate model audit

The literate-model pass audits every primary executable owner in
[Find an owner](#find-an-owner) and every repository file explicitly named
`oracle` or `property`. Derive that strict inventory from the repository rather
than copying a count into this document:

```sh
git ls-files -co --exclude-standard packages \
  | rg '/[^/]*(oracle|property)[^/]*$' \
  | sort -u
```

The command includes tracked and untracked package files so an in-progress
audit cannot hide a new owner. A surface is complete only when each primary
owner does one of these things:

- states its contract, model, history grammar, production path, and observations
  in the executable file, or
- records why that structure would add no useful information to a focused test.

The pass must not change product behavior. If clearer prose exposes a missing
model rule or assertion, strengthen the oracle and run it against unchanged
production first. Track any production failure as separate follow-up work.

The same pass audits vocabulary. Shared concepts use the production names in
the project glossary. The audit corrected model prose that collapsed a physical
acquisition into a request or called an acquisition lease merely a lease.
Model-only terms such as an appointment ledger or fault tape remain local and
say what production facts they abstract. This is a semantic review, not a rule
that test identifiers must copy production's private data structures.

| Surface | Status | Completed or next owner |
| --- | --- | --- |
| Ordered relations and BTree | Complete | The signed top-K relation, BTree/Map refinement model, and DBSP incrementalization laws are literate. |
| Includes and publication | Complete | The central recomputation model plus cross-formulation, temporal demand, layered publication, Collection facade lifecycle and space bounds, route-context transport, functional projection, query-shape, optimistic, and source-work owners are literate. They keep the architecture document as their contract source. |
| Collection lifecycle | Complete | The shared logical-owner/acquisition-attempt/sync-run grammar plus mutation admission, lifecycle trace, publication, replay, disposal, and transaction-refinement boundaries are literate. |
| Optimistic state | Complete | The independent base/intent/source-queue graph plus outcome, transaction-payload, and publication drivers are literate. |
| Drafts and native values | Complete | Native differential behavior, draft change tracking, detachment and its class-instance exception, hostile keys, aliases, cycles, and Map/Set live iteration are literate. |
| Query DB and observer | Complete | Query-scope row ownership, subset identity and cancellation, failure and recovery, and the per-listener eligibility ledger are literate. |
| Ordered acquisition | Complete | Exact demand identity, applied settlement, independent pagination recomputation, request work, lifecycle products, replay authority, source-generation readiness, and transaction-refinement abort boundaries are literate. |
| Join equality and cold acquisition | Complete | Independent cold relational recomputation, acquisition evidence, established equality domains, replacements, and scan/index routes are literate. |
| Opaque backend pagination | Complete | The full-relation value model plus opaque token, cache generation, publication, browser acquisition, and live-window integration owners are literate. |
| Electric and TrailBase | Complete | Electric replica and recovery models, installed-SDK HTTP delivery, PostgreSQL serialization, and TrailBase's controlled RecordApi/native-stream lifecycle are literate with their real-provider limits intact. |
| PowerSync | Complete | Patch conservation, effective-update receipts, metadata and falsey changes, declared-view keys, transformed schema output, logging, cleanup, and native SQLite reach are literate. |
| SQLite persistence and native hosts | Complete | Persisted hydration/replay and ownership, shared driver transaction laws, OPFS page and diagnostic state machines, and the 113-law native conformance manifest are literate. Native execution remains distinct from registration and shim evidence. |
| Offline execution | Complete | FIFO retry, scheduler eligibility, leadership replay, transaction settlement, and typed wire serialization are literate. |
| Frameworks | Complete | Shared live-query and infinite-query models are literate. Each framework keeps its own realm, ownership, and scheduling driver. |
| Structural values and ordered primitives | Complete | Structural hashing, deep equality, comparison, cursor denotation, index refinement, and query-identity output equivalence are literate. |
| Boundary refinements | Complete | Cleanup/restart admission, metadata publication, retained state, acquisition cells, D2 source reconciliation, top-K support windows, and nested Query work bounds are literate. |
| Small structures and test mechanics | Complete | SortedMap, cleanup appointments, and guarded replay are literate. |

### Recent fix-wave authority inventory

This inventory records the permanent authority for the September 17 fix wave. It
distinguishes an executable oracle from a specialized real-provider authority and
does not award oracle credit for a filename alone.

| PR | Classification | Permanent authority and campaign |
| --- | --- | --- |
| [#1831](https://github.com/TanStack/db/pull/1831) | Explicit oracle | PowerSync's `packages/powersync-db-collection/tests/correctness-oracle.test.ts` crosses real PowerSync receipts and native SQLite behavior. It runs in the package test campaign and the focused `test:oracles` campaign; portable declarations retain compiler authority. |
| [#1832](https://github.com/TanStack/db/pull/1832) | Equivalent specialized authority | `packages/electric-db-collection/e2e/sql-predicate-semantics.e2e.test.ts` and `packages/electric-db-collection/e2e/subset-sql-acceptance.e2e.test.ts` run through the package's real-provider `test:e2e` campaign. Compiler unit tests are collateral, not substitutes for either service boundary. |
| [#1833](https://github.com/TanStack/db/pull/1833) | Explicit oracle | `packages/db/tests/query/pagination-oracle.property.test.ts` owns inherited collection collation, actual `item2`/`item10` order, exact request options, hostile lexical/numeric controls, and both scan and auto-index paths. It runs in `@tanstack/db`'s `test:oracles` campaign. |
| [#1834](https://github.com/TanStack/db/pull/1834) | Explicit oracle | `packages/db/tests/query/cold-join-reconciliation-oracle.test.ts` owns join/predicate equality equivalence across the established value domains, binary/string and nullish controls, replacement histories, raw lazy demand, and scan/auto-index paths. It runs in `@tanstack/db`'s `test:oracles` campaign. |
| [#1835](https://github.com/TanStack/db/pull/1835) | Explicit oracle | The existing `packages/db/tests/collection-state-retention-oracle.property.test.ts` and `packages/db/tests/optimistic-transaction-oracle.property.test.ts` owners cover separate collection-state and transaction-history laws. Both were already registered in `@tanstack/db`'s `test:oracles` campaign; focused storage/local-only tests remain collateral. |
| [#1842](https://github.com/TanStack/db/pull/1842) | No shipped-law case | The PR changed only focused observer tests and introduced no production behavior. `packages/db/tests/live-query-observer.test.ts` remains the correct evidence; no synthetic oracle or campaign claim is added. |

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
| Ordered relations and BTree | [top-K relation oracle](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topk-relation-oracle.test.ts), [BTree/Map](https://github.com/TanStack/db/blob/main/packages/db/tests/btree-map-oracle.test.ts), [incrementalization laws](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/incrementalization-law.property.test.ts) | Independent ordered relations and cumulative signed output. Top-K consolidation compares same-key values without hashing, including cyclic replacements and fresh transient cancellation. Other hash-based operators retain hashing's declared domain. Algebra does not specify client readiness. |
| Includes and publication | [cross-formulation](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-cross-formulation-oracle.property.test.ts), [temporal](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-temporal-oracle.test.ts), [Collection includes](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-collection-oracle.property.test.ts), [architecture and complete suite map](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/ARCHITECTURE.md#executable-contracts) | Per-parent/flat-join/partition relations, callback-time rows, nested values, and route histories. Observe raw promised order; fresh queries do not establish continuous publication safety. |
| Collection lifecycle | [mutation startup](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-mutation-startup-oracle.test.ts), [history](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-history.property.test.ts), [publication](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-publication.property.test.ts), [replay](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-replay-oracle.property.test.ts), [effect disposal](https://github.com/TanStack/db/blob/main/packages/db/tests/effect-disposal-oracle.test.ts) | Core Collection `insert`/`update`/`delete` admission while `startSync:false` is idle; ownership and phase histories; exact caller/error/publication evidence; late completion and restart. Query write utilities and effect self-dependent disposal remain separate contracts. |
| Optimistic state | [history model](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-oracle.ts), [generated histories](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-transaction-oracle.property.test.ts), [outcomes](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-outcomes.test.ts), [publication](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-publication.test.ts) | Independent whole-row snapshots, rollback dependencies, metadata and prior-value events. Never rebase a pending snapshot merely to simplify the model. |
| Drafts and native values | [proxy](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy.test.ts), [detachment](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-detachment-contract.test.ts), [iteration](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-iteration-contract.test.ts) | Native-operation controls, exact patches and actual stored rows; alias/cycle/adversarial-key histories. General native-mutator and symbol-write support is not established by a plain-object oracle. |
| Query DB and observer | [ownership](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts), [load lifecycle](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts), [observer histories](https://github.com/TanStack/db/blob/main/packages/db/tests/live-query-observer-history.property.test.ts) | Real QueryClient boundary and a per-listener eligibility ledger, not a duplicate dispatch queue. Check reentry, peer survival, FIFO and disposal independently of final rows. |
| Ordered acquisition | [pagination](https://github.com/TanStack/db/blob/main/packages/db/tests/query/pagination-oracle.property.test.ts), [ordered work](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ordered-work-oracle.property.test.ts), [ordered lifecycle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts) | Complete finite provider results, inherited collation with exact own-key request options, real lexical/numeric disagreement, pending windows, ties/nulls, ownership and documented repair timing. Request completion is not proof of unrequested source extent. |
| Join equality and cold acquisition | `packages/db/tests/query/cold-join-reconciliation-oracle.test.ts` | Independent recomputation for cold acquisition plus direct join/predicate equivalence across established equality domains. Binary/string and nullish classes, replacement histories, raw on-demand values, and both scan/auto-index paths are explicit; compound join syntax is not claimed. |
| Opaque backend pagination | [window oracle](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.oracle.test.ts), [cache histories](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.cache-oracle.test.ts), [cache publication](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.publication-oracle.test.ts), [browser acquisition boundaries](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.boundary-oracle.test.ts), [QueryCollection integration](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.integration.test.ts) | Full filter/sort/slice reference, opaque token transport, actual Query cache expiry/invalidation/GC, forced refresh during growth, protocol failure publication/recovery, bounded slice work, nested cancellation/replacement, reader abort, browser retry defaults, manual-write cache isolation, and production window publications. Stable backend sequences; not snapshot guarantees for changing endpoints. Peek-ahead remains enabled. |
| Electric and TrailBase | [Electric histories](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/tests/electric-oracle.property.test.ts), [PostgreSQL semantics](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/e2e/sql-predicate-semantics.e2e.test.ts), [TrailBase contract](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/tests/ORACLE.md) | Installed SDK delivery/framing, independent predicates, exact subscription arguments and late errors. SDK fixtures and a real service test earn different credit. |
| PowerSync | [tests](https://github.com/TanStack/db/tree/main/packages/powersync-db-collection/tests), `tests/correctness-oracle.test.ts` | Applied receipt positions crossed with held peers, native SQLite/SDK and cleanup evidence. Run the focused owner with the package's `test:oracles` command. A timeout mutant proves a progress failure, not every value assertion. |
| SQLite persistence and native hosts | [persisted histories](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/persisted.test.ts), [Browser composed-owner histories](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts), [Browser coordinator RPC](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/browser-coordinator.test.ts), [driver contracts](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract.ts), [browser OPFS lifecycle](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts), [worker diagnostics](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-worker-diagnostics-oracle.test.ts), [Electron IPC and composed owner](https://github.com/TanStack/db/blob/main/packages/electron-db-sqlite-persistence/tests/electron-ipc.test.ts), [113-law manifest](https://github.com/TanStack/db/blob/main/packages/db-collection-e2e/src/fixtures/persisted-conformance-manifest.ts) | Core cache/remote rejection/peer/reopen histories and exact driver results. Browser composes public source commits with per-collection elected-owner routing and covers the complete committed-transaction wire partition through deterministic Node transport seams. Remote-subset histories distinguish logical demand, physical acquisitions, exact acquisition leases, and released replay tombstones. Electron composes source commits with a per-collection renderer owner, IPC adapter, real SQLite, and reopen checks. Controlled OPFS page/worker histories cover ownership and diagnostic-cause retention; fake workers and synthetic page events do not prove native handle release or real bfcache admission. The Browser composed seams are not real multi-context/OPFS-worker execution; the Electron harness is not an actual Electron process unless its explicit runtime-bridge mode runs. Registration-gated core remote demand and bounded host retry after transport/admission failure remain open review gaps. The manifest excludes progressive and move suites; registration and shim runs are not device execution. |
| Offline execution | [scheduler](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/KeyScheduler.property.test.ts), [leadership](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/leadership-replay.property.test.ts), [settlement](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/transaction-settlement.property.test.ts), [serialization](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/transaction-serializer.property.test.ts) | Declarative FIFO eligibility, per-transaction outcomes, durable state and typed wire trees. Issued work may finish after ownership loss, but new work must not start. Exactly-once network execution is not promised. |
| Frameworks | [React conformance](https://github.com/TanStack/db/blob/main/packages/react-db/tests/conformance.test.tsx), [React pagination](https://github.com/TanStack/db/blob/main/packages/react-db/tests/infinite-query-conformance.test.tsx), [shared suites](https://github.com/TanStack/db/tree/main/packages/db-collection-e2e/src/suites) | Exact exposed rows/pages and each framework's own lifecycle cuts. A React witness does not prove Vue/Solid/Angular/Svelte scheduling. Preserve their receiving registrations. |
| Structural values and ordered primitives | [hash values](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash.property.test.ts), [hash graphs](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-graph.property.test.ts), [mixed hash graphs](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-mixed-graph.property.test.ts), [hash retry](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-failure-retry.property.test.ts), [comparison](https://github.com/TanStack/db/blob/main/packages/db/tests/comparison.property.test.ts), [deep equality](https://github.com/TanStack/db/blob/main/packages/db/tests/utils.property.test.ts), [cursor](https://github.com/TanStack/db/blob/main/packages/db/tests/cursor.property.test.ts), [indexes](https://github.com/TanStack/db/blob/main/packages/db/tests/index-update.property.test.ts), [query identity](https://github.com/TanStack/db/blob/main/packages/db/tests/query/identity-output-shape-oracle.test.ts) | Independent flat values, graph topology, algebraic laws, Map/group/sort recomputation, expression denotation, and compiled output bags. Hash collision freedom is not promised. Unsupported composite cursors reject. |
| Boundary refinements | [cleanup/restart](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-cleanup-restart-oracle.test.ts), [metadata publication](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-metadata-publication-oracle.property.test.ts), [state retention](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-state-retention-oracle.property.test.ts), [acquisition cells](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-oracle.test.ts), [D2 source reconciliation](https://github.com/TanStack/db/blob/main/packages/db/tests/d2-source-reconciliation-oracle.property.test.ts), [top-K support windows](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topk-support-window-oracle.test.ts), [nested Query work](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/includes-work-counter-oracle.test.ts) | Explicit lifecycle products, independent source maps and weighted relations, exact publication cuts, support/multiplicity, and value-plus-work observations. These refine the larger subsystem models; they do not replace them. |
| Small structures and test mechanics | [SortedMap](https://github.com/TanStack/db/blob/main/packages/db/tests/SortedMap.test.ts), [cleanup queue](https://github.com/TanStack/db/blob/main/packages/db/tests/cleanup-queue.property.test.ts), [guarded replay](https://github.com/TanStack/db/blob/main/packages/db/tests/oracle-replay.test.ts) | Map/full-sort and appointment-list models with executed target/seed/path checks. Callback-reentrant scheduling is outside the initial cleanup-queue domain. |

## Acceptance map

The post-merge review added three missing domains to existing owners:

- [Top-K batch contracts](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topk-batch-contract.test.ts)
  cross sparse-array length/holes and RegExp source/flags/position with equal
  controls, replacement order, hash consolidation, and actual retained graph
  output. Ordinary replacements also run without the global `File` constructor.
- [Leadership replay](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/leadership-replay.property.test.ts)
  holds real storage-read delivery across successful and permanently rejected
  durable removals, with bounded scans, concurrent loads, and unfinished peers.
  This is distinct from exactly-once execution across independent owners.
- [Accepted-snapshot retention](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-state-retention-oracle.property.test.ts)
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
pnpm --filter @tanstack/db test:oracles
pnpm --filter @tanstack/powersync-db-collection test:oracles
# Service-dependent: requires Electric and PostgreSQL to be running.
pnpm --filter @tanstack/electric-db-collection test:e2e
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
