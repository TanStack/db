# Query DB physical Query ownership review

Reviewed executable head: `6faabf4aa`, including the merge of current main at
`d01357442`. The production repair commits are `1c4d6084a`, `2459bd94c`,
`5bc47aab4`, `29ce0d2bf`, and `6faabf4aa`. Baseline:
`91cefa260` (`origin/main` when the branch started). This record reviews the
replacement for PR #2143 against published Query Core 5.90.20. The accepted
scope gives Query DB ownership of the Query it creates. An acquisition releases
its own observer lease. A fetch keeps its physical Query signal while another
Query DB Collection acquisition owns that Query. After final release, Query
Core controls cancellation. An unrelated same-key `fetchQuery()` does not gain
a Query DB lease.

## Contract and distinguishing histories

The [Query Collection guide](../../collections/query-collection.md) promises
full-source reuse only after the result applies, request-scoped ownership,
revalidation of retained subset rows, and fetched value order by query-function
invocation. The [sync-adapter contract](../../guides/collection-options-creator.md)
supplies the acquisition and release boundary. The
[design grammar](2026-10-14-query-db-published-core-design-grammar.md) states
the bounded ownership model and its TLA+ abstraction.

| Law | Original or neighboring witness | Wrong design rejected at the checkpoint |
| --- | --- | --- |
| A new filtered acquisition needs current applied full coverage or its own response. An older dependent keeps its accepted lease when coverage fails. | The full result is pending or its refresh fails. Equal old and new filters then occupy full and exact Queries. One barrier holds deferred refresh after Query success; another holds the Collection commit after refresh starts. | Premature reuse fails at filtered settlement or public rows. Both release orders require the row owned only by the exact Query to leave with that owner. An unmatched fresh-options unload cannot release either lease, checked before valid owners release. The first filtered acquisition stays pending and its row absent at both barriers. |
| One physical fetch remains live for every Query DB owner of its Query. | Equal filtered peers and two Collections join a held fetch, then the first owner releases. | Per-acquisition cancellation aborts while a peer remains. Final release aborts a consumed signal. The ignored-signal control can finish into Query cache. |
| A retained persisted subset revalidates its owner before that subset settles. | A process stops while the subset is active and before a retention marker exists. Restart with an empty source, apply a full result, then acquire the subset. | A marker-only gate leaves the omitted row public and durable at subset settlement. Removing the markerless guard produced that failure. |
| A later invoked query function wins an overlapping fetched row while ownership remains continuous. | A cache callback reverses fetch-call acceptance and query-function invocation. The older result settles last. | The earlier action-order stamp leaves the wrong public value. The invocation-order check rejects it after both results settle. |
| A fresh response can replace an older persisted direct value. | Release the original acquisition, accept a direct write, restart from storage, then apply a fresh shared response. | Comparing only the persisted baseline misses the accepted row. The native SQLite restart witness failed before the result-application repair and passed after it. |
| A public cleanup or final unsubscribe during observer installation leaves no Query observer after the last Collection owner leaves. | A synchronous Query-cache `added` notification cleans up the Collection during Query construction, before the provider starts. Fetch notifications also clean up from cached or uncached readiness, add another public subscriber during cached or uncached installation, or remove the final subscriber during cached installation. | A late observer installation or overwritten unsubscribe leaves the old Query observed. The cleanup cases require the exact cache entry to be absent at cleanup settlement; the fetch-notification cases also check after the held provider resolves. |
| Query success cannot settle a pending load before its Collection result commit is accepted. Final owner release before acceptance cancels both the load and the write; a remaining peer keeps them live. | An in-memory wrapping sync holds `commit()` after one Query result. The history releases the final subscription, cleans up the Collection, or adds a peer before first-owner release. It observes the native public load promises and rows before and after opening the gate. | Removing the application wait fulfills a canceled load before the gate. Omitting commit cancellation publishes an unowned row after the gate. Canceling on first-owner release rejects a peer that still owns the Query. |
| Final release during result application cancels an unaccepted write, even when a callback reenters before `commit()` is called. | A wrapping sync releases the first subscription from `write()` with and without a remaining peer. A second history releases the final subscription from a Query-cache notification while Query DB holds a temporary observer listener. | Reserving the commit signal only at `commit()` publishes an unowned row after the load rejects. Treating the temporary listener as an acquisition lease retains a fetched-only row after final release. The peer control keeps its row. |

The primary production path is `queryCollectionOptions` through real
`Collection._sync.loadSubset` and `unloadSubset`, Query observers, and result
application. `load-subset-lifecycle-oracle.test.ts` checks provider calls,
signals, acquisition settlement, public rows, and both release orders.
`ownership-lifecycle.oracle.test.ts` checks public and durable rows and owner
metadata at retained-subset settlement. The SSR owner checks that spreading
request metadata exposes the physical Query signal. A server pagination fixture
accepts the lazy signal getter without changing predicate meaning.
The guide's empty-array description now states the Query ownership and
on-demand scope rule; its former absolute deletion claim contradicted both.

## Calibration and limits

The bounded TLA+ safe configuration explored 148 distinct reachable states.
Its hash-only release and per-acquisition abort variants each reached an
assertion counterexample at depth five. These are model counterexamples, not
production executions. In production tests, the unmatched-release witness
failed before identity-based lease release. A premature exact-Query release
control failed at its new immediate row checkpoint. The markerless restart failed when
its guard was removed. The reentrant fetched-value check failed under the old
action-order stamp. The corrected owners pass. The two persisted restart cases
failed after their formerly ineffective releases became real; they pass after
the accepted-row comparison repair.
The controlled application-barrier witness rejected a premature readiness
control before the barrier opened and a skipped application wait while the
Collection commit was held, in both initial and replacement full-result
histories. The first acquisition is recorded once; the old ungated version
passed the premature readiness control. Full and exact responses share the
checked row, so this witness establishes waiting for valid applied coverage;
it does not identify which response's receipt establishes that coverage. The
Query-cache `added` cleanup witness failed before the post-construction guard.
The cached and uncached fetch-notification cleanup witnesses failed before late observer
release was added. The cached nested-subscriber witness failed with one
remaining Query observer before the subscription slot was reserved. Its
uncached form checks the readiness-to-main-observer handoff and also passes.
The cached final-subscriber witness checks the slot's release path without
explicit Collection cleanup. The new cleanup witnesses
preserve a primary assertion failure as the cause when cleanup also fails and
report each cleanup step separately.
The held-commit witness fails on the original waiter after final release: its
load fulfills before the gate with no row. Keeping the waiter registered until
application settlement rejects that outcome. Removing the final-release commit
abort then publishes the row after the gate; canceling at first-owner release
instead rejects the live peer. Passing the per-result application signal to a
wrapping commit also canceled valid persistence work when a newer result
replaced the old one; two cache-rotation oracles caught that. The repair uses a
Query-owner commit signal, and all three held-commit histories pass. The native
SQLite retained-scan regression now expects a pending load to reject after
its last owner unloads.

The write-callback history failed at the public-row assertion before the
commit signal was reserved, then passed with the signal reserved before
reentrant callbacks. The temporary-listener history failed at its fetched-only
row assertion while `hasListeners()` could veto final cleanup, then passed
when the acquisition refcount alone controlled Query DB row ownership. The
ownership oracle also rejects a zero-lease internal observer listener as an
owner; its former cache-patch expectation depended on a listener extending
Query DB's lease.

At `6faabf4aa`, the Query DB package passed 836 unit tests and 127 E2E tests.
Its TypeScript check and package build passed. Changed-file ESLint had zero
errors and 10 existing warnings across the source and touched test files.
Prettier and `git diff --check` passed. The E2E run used local builds of `offline-transactions` and
`electric-db-collection`.

This evidence covers the bounded static-key full-source path, equal filtered
peers, two Collection owners of one Query, held fetches, the named persisted
restart states, the named ordering reversal, the held in-memory commit cut,
and the two reentrant final-release cuts. The
[coverage map](../oracle-coverage.md) retains arbitrary predicate containment,
function-built keys, TTL retention, other persisted startup histories, real
network cancellation, and cross-Collection option selection beyond installed
Query Core 5.90.20 as separate receiving work. The TLA+ lease model does not
include Collection result acceptance. No claim here assigns a Query DB
lease to an unrelated same-key Query Core caller.

## Oracle guide audit

| Requirement | Review result |
| --- | --- |
| ORC-001 authority and limits | The guide, sync-adapter contract, and user ownership decision supply the laws. The preceding scope and coverage map bound them. |
| ORC-002 independent judgment | The small lease model chooses expected ownership from accepted acquisitions. Persisted expected rows come from authored source snapshots, not Query DB's owner classifier. |
| ORC-003 literate responsibilities | Each owner states its law before test mechanics and places model, legal history, production path, observations, and checkpoint beside the checks. |
| ORC-004 grammar controls | The design grammar gives reconstruction, ablation, adjacent forms, and exclusions for the bounded lease and signal model. The changed production oracles use fixed history matrices. |
| ORC-005 path and observation | Real Collection and Query Core paths reach the named provider, release, result-application, public-row, and durable-row checkpoints. The held-commit fixture checks native public load promises and rows before acceptance and after its gate opens. The controlled fixtures do not prove a real network provider's timing. |
| ORC-006 checker calibration | Hash-release and per-acquisition-abort TLA+ weakenings fail their invariants. The markerless, action-order, unmatched-release, premature exact-release, premature readiness, and skipped application-wait production controls fail at their intended assertions. The held-commit witness separately rejects an omitted application wait, omitted final-release commit abort, and first-owner commit cancellation. The write-callback and temporary-listener witnesses failed at their public-row assertions before their respective repairs. |
| ORC-007 fixed and random replay | No changed test claims an important random generated property. The TLA+ model enumerates a bounded state space without seeds or shrink paths. |
| ORC-008 model state | The design grammar retains separate logical owners and physical leases because equal predicates can route to different Queries. It retains signal consumption because final release differs when the provider ignores the signal. |
| ORC-009 vocabulary | The design grammar maps its `eligible` abstraction to current applied coverage. It splits equal old and new acquisitions by time and maps them to the glossary's acquisition and observer leases. |
| ORC-010 failure and cleanup | The six observer-installation, three held-commit, two write-callback, and one cache-notification public histories run every cleanup step and preserve the primary mismatch as the cause of an `AggregateError` when cleanup also fails. A dual-fault control checks the cause, named secondary error, and final cleanup step. Older fixed lifecycle witnesses still use `finally`; a throwing cleanup can mask their primary assertion or skip later releases. The coverage map keeps that harness repair open. The TLA+ runs completed with invariant verdicts; no reduction failure was used as product evidence. |
| ORC-011 second formulation | The lease and signal TLA+ model is structurally separate from the Query DB production path. The persistent-row and fetched-value claims use independent authored snapshots and reentrant invocation order. |
| ORC-012 review evidence | This record binds the claim, controls, validation, and remaining cells to executable head `6faabf4aa`, with production repair commits `1c4d6084a`, `2459bd94c`, `5bc47aab4`, `29ce0d2bf`, and `6faabf4aa`. |
| ORC-013 boundary witness | Applied versus pending/failed full results, Query success versus deferred refresh versus held Collection commit, first versus final owner release, release during `write()` versus after entering `commit()`, peer present versus absent, marker versus markerless owner, acceptance versus invocation order, Query-cache `added` versus `fetch` reentry, and cached versus uncached reentrant observer installation distinguish nearby wrong rules. Release after commit acceptance while publication remains held has no witness here. |
| ORC-014 controlled-premise handoff | Provider and storage fixture claims stop at those boundaries. Native SQLite covers the stated direct-value restart; real network cancellation and additional host paths stay open in the coverage map. |
