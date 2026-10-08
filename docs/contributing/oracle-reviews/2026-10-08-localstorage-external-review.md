# LocalStorage external review of PR #2074

Reviewed PR head: `8abbf5b14d601ce0e636de36fbc210e60da4f12e`.
The external review supplied ten code-reading findings and no executed tests.
This record keeps their source order. A later repair commit must name its own
head and recheck affected evidence before changing these dispositions.

## Finding ledger

| ID | Claim | Evidence on the reviewed path | Disposition and durable value |
| --- | --- | --- | --- |
| R1 | Un-awaited manual acceptance can settle a transaction before its queued Storage write, and a later error becomes unhandled. The changeset is patch despite an async API change. | With a held automatic predecessor, the manual transaction reached `completed` while storage was `null`. A later quota fault reached an `unhandledRejection` listener after the earlier handler returned. | **Design decision.** The approved new contract requires awaiting `acceptMutations`; old callers cannot obtain a correct receipt without doing so. Decide whether to preserve old callers through transaction-level tracking or release this incompatible contract as a minor version. The general mutation guide's example now uses `await` for both LocalOnly and LocalStorage. |
| R2 | A collection-wide queue blocks unrelated keys; use per-key chains. | The order oracle's disjoint-key held-handler history reaches and asserts this wait. | **Accepted design.** The user approved mutation order across the Collection, including manual writes. A per-key queue would weaken its receipt-order law. The remaining head-of-line cost is explicit, including a handler that never settles. |
| R3 | A handler awaiting a nested same-Collection persistence receipt deadlocks. | A controlled probe held the outer handler on the inner receipt: both receipts remained pending and storage stayed empty until an external escape let the outer handler return. | **Accepted design.** The order oracle checks the legal fire-and-forget neighbor. The guide excludes this dependency cycle under the approved order law. A fail-fast contract would need a new decision and a reliable way to identify the Promise dependency. |
| R4 | Direct `acceptMutations` throws while queued acceptance rejects, so `.catch()` is timing-dependent. | The new order-oracle direct-fault case failed on reviewed production at its no-synchronous-throw assertion; the queued counterpart passed. | **Fixed in working repair.** `acceptMutations` is async, so both Storage faults and pre-reservation validation faults reject its returned Promise. The same oracle cases pass and preserve exact error identity for Storage faults. |
| R5 | An empty stored string errors at startup and blocks writes. | The peer oracle checks `''` against a missing `null` key. It requires startup error and unchanged bytes for `''`, then permits a clear/restart and normal first write from `null`. | **Refuted as a bug.** This is the approved malformed-data law. Treating existing empty bytes as absence would silently erase data. |
| R6 | Each write parses and stringifies the full snapshot. | Five direct writes with a counting parser produced four full parses after the initially absent key and five full-snapshot stringifications. | **Accepted design.** The peer oracle kills the old cache-only writer that lost unseen peer rows. Without an external-change signal, reusing a parsed snapshot would reopen that loss. No latency threshold or measured regression was supplied. |
| R7 | Reusing one options object for two Collections can silently drop a manual mutation. | `createCollection(options)` twice, followed by two preloads and manual acceptance for the first Collection, yielded a completed transaction and no durable row. The second preload replaced the shared sync's Collection reference. | **Design decision.** Decide whether direct options-object reuse must materialize independent adapter state or fail explicitly. The existing equal-ID ownership oracle rules out restoring the old ID fallback, which wrote mutations to unrelated stores. |
| R8 | A same-tab Collection sharing a storage key may retain a stale public snapshot. | Two Collections from separate options shared one Storage object/key. After the first persisted an insert, durable storage and its own public snapshot had the row; the second public snapshot remained empty without an event. | **Design decision.** Decide whether same-tab peers synchronize automatically or the API limits each tab to one active Collection per storage key. The existing peer oracle's event-delivery assertion does not reach this no-event history. |
| R9 | Confirming an insert as a sync update can replace a peer row; partial mode might merge stale fields. | The peer oracle reaches a peer insert on the same key while a local insert is pending. The later accepted local whole row wins in storage and both public snapshots without duplicate-key failure. `rowUpdateMode` is `full`. | **Accepted design for current mode.** The mechanism is real; its implied current bug is not. Partial row mode is speculative and would need a separate contract and witness before adoption. |
| R10 | `reservedWrites` duplicates queue state; a missed decrement could disable the synchronous path. | No missed decrement was reproduced on reviewed production. A working repair removes the counter, then checks a third handler-free mutation at direct return after a held queue drains. Removing the new tail clear as a hostile mutant leaves `b.value` at `0` instead of `4` and fails the intended assertion. | **Fixed in working repair as simplification.** The state count disappears. The mutant failure is a direct-return assertion, and the restored implementation passes. |

The review's prose repeated R2, R3, and R5 from its earlier pass; those claims
remain accounted for above. Its earlier corrupt-data finding was not repeated.
No item is deferred. R1, R7, and R8 remain open product decisions; a green
test run cannot close them.

## Law coverage and enforcement

The order owner is
[`local-storage-order-oracle.test.ts`](../../../packages/db/tests/local-storage-order-oracle.test.ts).
Its independent authored-row fold judges accepted automatic and awaited manual
effects. Finite histories vary same/disjoint keys, both handler completion
orders, accepted/rejected decisions, update/delete, a legal nested
fire-and-forget write, and a held automatic predecessor before manual
acceptance. The production driver uses real Collection mutations and manual
transactions. It compares direct-return Storage effects, held-handler
settlement and durable state, final public/durable rows, and fresh restore.
The new manual error-channel cases add direct and queued Storage faults and a
validation fault. The reviewed direct path failed before returning a Promise;
the working repair passes all three. A hostile tail-clear mutant fails the
post-drain direct-return assertion; the working repair passes it.

The peer owner is
[`local-storage-peer-oracle.test.ts`](../../../packages/db/tests/local-storage-peer-oracle.test.ts).
It models absent, valid, and malformed stored snapshots independently of the
adapter parser. The production driver controls peer event delivery, startup,
clear, and a pending same-key local insert beside a peer insert. It compares
startup status and bytes, held optimistic and durable rows, event-delivered
public rows, and fresh restore. The empty-string, null-key, and pending-insert
witnesses pass on the reviewed head. Native browser event scheduling, direct
options reuse, and same-tab no-event peer publication remain outside this
owner's claimed grammar. The coverage map must retain those limits until the
R7 and R8 decisions are implemented or explicitly bounded.

The manual error law is fully encoded and enforced within the finite direct,
queued, and validation-fault grammar. It does not assert that an un-awaited
caller receives a correct transaction receipt. That is R1's separate contract
choice. The accepted queue law is enforced for the named finite schedules;
arbitrary long histories and a handler that never settles are not claimed.

## Oracle guide audit for the working repair

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Opening prose names direct-return and manual-Promise laws and excludes the nested-await cycle. The public guide and declared `Promise<void>` API are the authorities. |
| ORC-002 | The authored-row fold does not use production queue or Storage cache logic. The error law compares the exact injected Error object and unchanged durable rows. |
| ORC-003 | Contract, pure fold, finite history grammar, real Collection driver, and direct/held/final comparisons remain distinguishable beside the code. |
| ORC-004 | Not triggered: these are finite enumerations and fixed controlled faults, not an important generated property. |
| ORC-005 | The driver reaches public `acceptMutations`, mutation methods, transaction receipts, and Storage effects at the named cuts. |
| ORC-006 | Reviewed production failed direct manual-error assertion. Queued error was an adjacent passing control. The tail-clear mutant failed direct-return assertion, not setup or timeout. |
| ORC-007 | Not triggered: no generated property was added or changed. |
| ORC-008 | Not triggered: the independent authored-row fold did not gain state. The queue simplification removes production state only. |
| ORC-009 | The fold's authored edit is a public Collection mutation; its accepted decision maps to mutation-handler outcome. Storage slot is production-only and does not enter the model. |
| ORC-010 | `withHistoryCleanup` retains the primary comparison while releasing held promises and Collection resources. No shrinking occurs. |
| ORC-011 | No named shared semantic classifier fault needs a second formulation for these error and retirement cuts. |
| ORC-012 | This record accounts for every applicable requirement and keeps the unresolved R1/R7/R8 laws visible. |
| ORC-013 | Direct versus queued error paths and the post-drain direct call distinguish plausible wrong boundaries. |
| ORC-014 | No real-browser event delivery is claimed. R8's controlled no-event probe needs a receiving browser witness if same-tab synchronization becomes a product law. |

The five-file LocalStorage run passed 119 runtime tests and 14 type tests with
no type errors after the working repair. The package build and changed-file
ESLint passed. These results do not settle the three open design decisions.
