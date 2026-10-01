# Oracle guide portfolio review — 2026-09-30

Executable revision: 7e4266bb7a38b55528fbf023921061320eba792e
Guide revision: a1d75726
Review scope: the 90 executable files under packages whose basenames contain oracle or property and end in .test.ts, .test.tsx, or .test-d.ts. Each owner was assigned to a separate fresh agent. This inventory rule includes three compile-time type oracles. Other specialized contract tests in the coverage map remain separate owners.

This record assesses the executable revision above. Later edits require a new record or an append-only follow-up tied to their own revision. A passing sampled campaign is evidence inside its declared domain, not a proof over all legal histories. No bug-class closure or general real-provider claim is made by this portfolio audit.

## Result and verification

85 owners were revised; 5 were retained after review. The revision changes tests, test support, package oracle commands, and the coverage map; it changes no production source. The guide added ORC-013, which asks for a distinguishing boundary witness, and ORC-014, which asks for a receiving witness or an explicit handoff when a controlled premise is cited across a provider or host boundary.

| Runtime campaign | Result |
| --- | ---: |
| DB oracle/property files, including guarded replay | 3,541/3,541 |
| DB IVM | 181/181 |
| Query DB Collection | 272/272 |
| Browser SQLite persistence | 67/67 |
| PowerSync | 11/11 |
| TrailBase | 41/41 |
| Node SQLite persistence | 52/52 |
| SQLite persistence core | 29/29 |
| Vue | 6/6 |
| Offline transactions | 124/124 |
| Electric | 294/294 |

These runs cover 87 runtime files and 4,618 passing tests. The three type-only owners were checked through their package TypeScript builds. TypeScript checks passed for DB, DB IVM, Query DB, Browser, PowerSync, TrailBase, Node SQLite, SQLite core, Vue, and Offline. Electric's runtime campaign passed; its package TypeScript command still reports three imports of @tanstack/electric-db-collection from unchanged shared end-to-end suites. Prettier, the staged ESLint hook, and git diff --check passed. The DB replay integration used filesystem access for child Vite temporary files.

## ORC-001–014 verdict ledger

This is a portfolio-level ledger. The executable file is the primary evidence for each owner; the inventory below identifies every reviewed file. A partial outcome means the named trigger remains open for at least one owner. A conditional outcome applies only where the requirement's trigger holds. The coverage map names receiving owners for cross-boundary cells.

| Requirement | Outcome at executable revision | Evidence and remaining limit |
| --- | --- | --- |
| ORC-001 contract authority and limits | Partial | Opening contracts and bounds were added or clarified across owners. The comparison normalization rule and FIFO one-timer assertion still need explicit authority. Offline settlement has a direct README/test contradiction, listed below. |
| ORC-002 independent judgment | Bounded | Independent arrays, maps, ledgers, algebraic relations, and authored provider responses remain the expected-result sources. The comparison audit found and corrected a false reference rule: signed infinity is a valid comparator result. Shared semantic faults remain possible outside the bounded formulations. |
| ORC-003 visible responsibilities | Bounded | Agents checked the contract, model, grammar, production driver, and refinement check in each assigned owner or directly named companion. The compile-time owners state their type-level boundary rather than claiming runtime delivery. The five retained owners were reviewed without a source edit. |
| ORC-004 grammar controls | Partial, generated owners only | Added reconstruction, axis contribution, bounds, marginal cases, and exclusions in many generated owners. Full ablation/reconstruction evidence remains incomplete in some large includes and utility grammars. Fixed-only and type-only owners do not trigger this rule unless they claim a generated grammar. |
| ORC-005 production path and observation | Bounded | All runtime owner campaigns reached their named production driver and comparison; the package results above are reach evidence. Controlled callbacks, fake storage, authored HTTP, and synthetic host events establish only their declared boundary. The type-only owners do not make a runtime observation claim. |
| ORC-006 checker calibration | Partial, important generated or repaired owners only | Wrong-result controls and captured hostile failures were added, including comparison, cursor, index update, leadership, scheduler, Electric SDK delivery, and settlement. Some laws still lack a demonstrated distinguishing kill at the intended checkpoint; a green campaign alone was not counted as calibration. |
| ORC-007 fixed/random parity and direct replay | Partial, important generated owners only | Named paired campaigns and seed/path replay were added broadly. The guarded replay suite passed 28/28 after the manifest learned computed includes and pagination IDs. Captured failing shrink-path replay is still unshown for some secondary generated laws, including the offline serializer. Fixed-only, diagnostic, and type-only owners do not trigger this rule. |
| ORC-008 stateful-model minimality | Conditional | No portfolio-wide state-minimality proof is claimed. Owners that changed a model's state mapping explain distinctions locally; a file without an introduced, removed, combined, or split model state does not trigger this rule. Any unrecorded state change remains an audit gap. |
| ORC-009 vocabulary mapping | Conditional | Model-only Pair, Scope, ledger, tag-bit, and clock abstractions were mapped to production boundaries in the relevant files. A file with no divergent model term does not trigger this rule. The project glossary remains authoritative for shared terms. |
| ORC-010 failure fidelity and cleanup | Partial | The guarded replay harness now preserves the primary failure as an AggregateError cause and labels cleanup diagnostics. Many owner cleanups were strengthened. The core load-subset owner still has cleanup paths that may mask a mismatch; the Electric SDK shared cleanup helper has not had a simultaneous cleanup fault injected. Some multi-assertion properties do not retain a pre-shrink failure signature. |
| ORC-011 second formulation | Conditional | The includes cross-formulation owner exercises distinct query formulations. Where no concrete shared-fault hypothesis was named, the trigger does not apply. A newly named shared fault requires a separate formulation or an explicit tracked reason under this rule. |
| ORC-012 review evidence | Recorded with gaps | This exact-revision ledger and inventory provide the closeout record. Partial entries and the owner table below remain unresolved; the record does not convert them into passes. No bug-class closure is claimed. |
| ORC-013 distinguishing boundary witness | Partial | Added legal premise-reaching and nearby distinguishing cases, including includes-space leaf counts 0/1/10, comparator infinity/NaN, pagination margins, optimizer accepting/rejecting filters, retry deadlines, and FIFO K=1/K=2. The held finite child repair/facade subscriber and other cells below remain open. |
| ORC-014 controlled-premise handoff | Partial where cross-boundary claims are made | The coverage map now names controlled premises and receiving owners. A controlled-only claim does not trigger a real-provider obligation. Real OPFS persist FIFO, live Electric-service framing, native Temporal/browser storage, and several provider paths have no matching receiving witness at this revision. |

## Material findings and open owner cells

| Owner | Requirement | Finding or next witness |
| --- | --- | --- |
| packages/db/tests/comparison.property.test.ts | ORC-001, ORC-010 | Corrected the reference model to accept signed infinity, matching the established comparator/index contract. Exact authority for some internal normalization encodings remains weaker; multi-assertion shrink reports do not retain the original mismatch separately. |
| packages/offline-transactions/tests/KeyScheduler.property.test.ts | ORC-005, ORC-014 boundary | Corrected the modeled retry sequence to updateTransaction before markFailed. This scheduler owner does not observe the executor's awaited outbox update or public caller settlement; transaction-settlement owns the receiving cut. |
| packages/offline-transactions/tests/transaction-settlement.property.test.ts | ORC-001 | README says success follows durable outbox removal. The existing acknowledgement-delete-failure test expects fulfillment while the outbox row remains. The contract owner must resolve this conflict before claiming the settlement law closed. |
| packages/offline-transactions/tests/fifo-retry.property.test.ts | ORC-001 | FIFO and retry-deadline behavior are documented; the exact one-timer/no-poll assertion still needs explicit contract authority. |
| packages/offline-transactions/tests/transaction-serializer.property.test.ts | ORC-007, ORC-014 | The generated grammar now reconstructs its ten-edit pinned history. Direct seed/path replay runs, but a captured failing shrink-path replay was not demonstrated. Native Temporal and browser-storage receiving witnesses are not supplied. |
| packages/db/tests/query/load-subset-oracle.property.test.ts | ORC-010, ORC-014 | Exact demand-key witnesses were added. Some cleanup paths can still replace a primary assertion; controlled adapter delivery does not prove real-provider behavior. |
| packages/electric-db-collection/tests/electric-sdk-delivery.property.test.ts | ORC-010, ORC-014 | Same-checkpoint shrink/replay now rejects row-drop and silent-move faults through the installed SDK and controlled HTTP. Simultaneous secondary cleanup failure is untested; a live Electric service has not supplied these authored frames. |
| packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts | ORC-014 | Node seam distinguishes K=1/K=2 and full logical persist FIFO. Chromium OPFS checks K=1 hydrate, but full real OPFS persist completion order remains open with the Browser OPFS fairness spec owner. |
| packages/db/tests/query/includes-collection-oracle.property.test.ts | ORC-013 | A held truncate replay witness was added. A finite child A→B→A repair with a Collection facade subscriber is still needed; the coverage map keeps this with the same owner. |
| packages/db/tests/query/includes-optimistic-oracle.property.test.ts | ORC-013 | A concurrent optimistic update to the same root row during held repair still needs public snapshot and event comparison. |
| packages/query-db-collection/tests/includes-work-counter-oracle.test.ts | ORC-013 | Current nested tree makes every branch reachable. An irrelevant-branch acquisition witness is still needed to support a broader work claim. |
| packages/db/tests/query/subquery-user-value-oracle.test.ts | ORC-013 | DISTINCT support transitions are checked; aggregate source-update histories and joined findOne/singleResult are open. |
| packages/db/tests/query/optimizer-semantics-oracle.test.ts | ORC-013 | Accepting and rejecting outer filters are now checked. Inner-join global-aggregate behavior remains an open path. |
| packages/db/tests/utils.property.test.ts | ORC-004, ORC-006, ORC-013 | Ring boundaries and a replayed hostile comparator are checked. Non-ring generator ablation, some law calibrations, and adjacent witnesses remain incomplete. |
| packages/powersync-db-collection/tests/correctness-oracle.test.ts | ORC-014 | Native SQLite and unmocked ordinary watcher delivery run. Held callbacks are controlled; synthetic no-op/metadata mutations do not prove Collection.update can construct them or that remote backend upload behaves identically. |
| packages/db/tests/d2-source-reconciliation-oracle.property.test.ts | ORC-014 | Controlled indexed Effect consumption does not establish graph restart/truncate, scan routes, or external provider delivery. |
| packages/db/tests/query/virtual-row-fields-oracle.test.ts | ORC-013 | Direct public field presence is checked at publication. Projection-shape and framework receiving boundaries remain outside this fixed owner. |

The coverage map contains additional scoped limits for ordered acquisition, provider transport, type-only oracles, and includes publication. These entries are unresolved cells, not waiver text. A new closure claim must supply the missing legal history, production path, public observation, and named checkpoint.

## Owner inventory

Revised means changed in executable revision 7e4266bb; retained means the assigned reviewer kept the source as it was. Every owner below is bounded by the verdict ledger above.

| Executable owner | Disposition |
| --- | --- |
| packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts | revised |
| packages/browser-db-sqlite-persistence/tests/opfs-worker-diagnostics-oracle.test.ts | revised |
| packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts | revised |
| packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts | revised |
| packages/db-ivm/tests/hash-failure-retry.property.test.ts | revised |
| packages/db-ivm/tests/hash-graph.property.test.ts | revised |
| packages/db-ivm/tests/hash-mixed-graph.property.test.ts | revised |
| packages/db-ivm/tests/hash.property.test.ts | revised |
| packages/db-ivm/tests/incrementalization-law.property.test.ts | revised |
| packages/db-ivm/tests/multiset-consolidate-oracle.property.test.ts | revised |
| packages/db-ivm/tests/operators/topk-relation-oracle.test.ts | retained |
| packages/db-ivm/tests/operators/topk-support-window-oracle.test.ts | revised |
| packages/db-ivm/tests/temporal-group-key-oracle.test.ts | revised |
| packages/db-sqlite-persistence-core/tests/persisted-options-type-oracle.test-d.ts | revised |
| packages/db-sqlite-persistence-core/tests/persisted-readiness-oracle.test.ts | revised |
| packages/db/tests/btree-map-oracle.test.ts | revised |
| packages/db/tests/change-event-history-oracle.test.ts | revised |
| packages/db/tests/cleanup-queue.property.test.ts | revised |
| packages/db/tests/collection-cleanup-restart-oracle.test.ts | revised |
| packages/db/tests/collection-metadata-publication-oracle.property.test.ts | revised |
| packages/db/tests/collection-mutation-startup-oracle.test.ts | revised |
| packages/db/tests/collection-state-retention-oracle.property.test.ts | revised |
| packages/db/tests/collection-subscription-lifecycle-history.property.test.ts | revised |
| packages/db/tests/collection-subscription-lifecycle-oracle.test.ts | revised |
| packages/db/tests/collection-subscription-lifecycle-publication.property.test.ts | revised |
| packages/db/tests/collection-subscription-reentrancy-oracle.test.ts | revised |
| packages/db/tests/collection-subscription-replay-oracle.property.test.ts | revised |
| packages/db/tests/collection-truncate-ownership-oracle.property.test.ts | revised |
| packages/db/tests/comparison.property.test.ts | revised |
| packages/db/tests/cursor.property.test.ts | revised |
| packages/db/tests/d2-source-reconciliation-oracle.property.test.ts | revised |
| packages/db/tests/db-client-hydration-authority-oracle.test.ts | revised |
| packages/db/tests/effect-disposal-oracle.test.ts | revised |
| packages/db/tests/index-suggestion-oracle.test.ts | revised |
| packages/db/tests/index-update.property.test.ts | revised |
| packages/db/tests/live-query-observer-history.property.test.ts | revised |
| packages/db/tests/mutation-handler-type-oracle.test-d.ts | revised |
| packages/db/tests/optimistic-transaction-oracle.property.test.ts | revised |
| packages/db/tests/oracle-replay.fixture.test.ts | retained |
| packages/db/tests/oracle-replay.test.ts | revised |
| packages/db/tests/paced-mutations-oracle.test.ts | retained |
| packages/db/tests/query/cold-join-reconciliation-oracle.test.ts | revised |
| packages/db/tests/query/identity-output-shape-oracle.test.ts | retained |
| packages/db/tests/query/includes-collection-oracle.property.test.ts | revised |
| packages/db/tests/query/includes-context-transport-oracle.test.ts | revised |
| packages/db/tests/query/includes-cross-formulation-oracle.property.test.ts | revised |
| packages/db/tests/query/includes-functional-projection-oracle.test.ts | revised |
| packages/db/tests/query/includes-optimistic-oracle.property.test.ts | revised |
| packages/db/tests/query/includes-oracle.property.test.ts | revised |
| packages/db/tests/query/includes-publication-oracle.test.ts | revised |
| packages/db/tests/query/includes-query-shape-oracle.test.ts | revised |
| packages/db/tests/query/includes-space-oracle.test.ts | revised |
| packages/db/tests/query/includes-temporal-oracle.test.ts | revised |
| packages/db/tests/query/includes-work-counter-oracle.test.ts | revised |
| packages/db/tests/query/index-path-collision-oracle.test.ts | revised |
| packages/db/tests/query/load-subset-oracle.property.test.ts | revised |
| packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts | revised |
| packages/db/tests/query/load-subset-source-readiness-refinement-oracle.test.ts | revised |
| packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts | revised |
| packages/db/tests/query/optimizer-semantics-oracle.test.ts | revised |
| packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts | revised |
| packages/db/tests/query/ordered-work-oracle.property.test.ts | revised |
| packages/db/tests/query/pagination-oracle.property.test.ts | revised |
| packages/db/tests/query/subquery-user-value-oracle.test.ts | revised |
| packages/db/tests/query/virtual-row-fields-oracle.test-d.ts | revised |
| packages/db/tests/query/virtual-row-fields-oracle.test.ts | revised |
| packages/db/tests/utils.property.test.ts | revised |
| packages/electric-db-collection/tests/electric-oracle-lifecycle.test.ts | revised |
| packages/electric-db-collection/tests/electric-oracle.property.test.ts | revised |
| packages/electric-db-collection/tests/electric-recovery-oracle.test.ts | revised |
| packages/electric-db-collection/tests/electric-sdk-delivery.property.test.ts | revised |
| packages/electric-db-collection/tests/pg-serializer.property.test.ts | revised |
| packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts | revised |
| packages/offline-transactions/tests/KeyScheduler.property.test.ts | revised |
| packages/offline-transactions/tests/connectivity-replay-oracle.test.ts | revised |
| packages/offline-transactions/tests/fifo-retry.property.test.ts | revised |
| packages/offline-transactions/tests/leadership-replay.property.test.ts | revised |
| packages/offline-transactions/tests/oracle-lifecycle.test.ts | revised |
| packages/offline-transactions/tests/transaction-serializer.property.test.ts | revised |
| packages/offline-transactions/tests/transaction-settlement.property.test.ts | revised |
| packages/powersync-db-collection/tests/correctness-oracle.test.ts | revised |
| packages/query-db-collection/tests/cursor-pagination.boundary-oracle.test.ts | revised |
| packages/query-db-collection/tests/cursor-pagination.cache-oracle.test.ts | revised |
| packages/query-db-collection/tests/cursor-pagination.oracle.test.ts | revised |
| packages/query-db-collection/tests/cursor-pagination.publication-oracle.test.ts | revised |
| packages/query-db-collection/tests/includes-work-counter-oracle.test.ts | revised |
| packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts | revised |
| packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts | retained |
| packages/trailbase-db-collection/tests/lifecycle-oracle.property.test.ts | revised |
| packages/vue-db/tests/useLiveQuery-publication-oracle.test.ts | revised |
