# Subscription reentrancy guard audit

Reviewed production head: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
Source review: GAP-01 in the local code-weight audit. Mutation calibration ran
against the unchanged reviewed head. An independent review later found three
product bugs and led to a production repair. Each mutant came from
the audit's `subs-guard-mutants.py`, was installed alone, and was restored before
the next run. This record describes the new oracle's scope and the evidence that
supports it. The lossless finding ledger stays outside the repository.

## Contract and observation boundary

The Collection lifecycle grammar owns logical demand, physical acquisition,
sync-run cleanup, replay, and publication. At a direct snapshot's synchronous
return, a callback that retires the demand or subscription must prevent a local
snapshot publication. This law includes a loader that releases the original
request predicate while the subscription combines it with another predicate.
Adapter unload follows an accepted acquisition exactly once. A released demand
must not retain a rejected replay error while a peer
keeps the replay open. A stale acquisition settlement must not erase the loading
status of demand waiting for restart setup.

The companion oracle records return values, result-hook calls, row callbacks,
exact unload options, abort-listener removal, subscription status, delegated
replay calls, and acquisition release at explicit microtask cuts. The
released-error check uses one narrow white-box retention observation because
the downstream public failure filter masks that reference while a peer remains
pending. These checks cover the bounded callback and timing histories in the
companion file. They do not claim every callback composition or provider effect.

## Mutation calibration

Initial baseline: 16/16 companion tests passed. The following 11 mutants failed by
assertion at their intended checkpoint:

| Mutant | Distinguishing observation |
| --- | --- |
| M5 | Delegated replay starts after status-reentrant release removed its only demand. |
| M10 | An unoptimized fallback read continues after its callback unsubscribes. |
| M12 | The request abort listener is not removed after acquisition release. |
| M13 | Obsolete settlement changes `loadingSubset` to `ready` before queued restart setup. |
| M15 | Releasing a requested predicate fails to unload the acquisition when the subscription adds its own predicate. |
| M16 | A user operand's `Symbol.toPrimitive` unsubscribes during snapshot evaluation, but the request continues. |
| M17 | A loader-reentrant release or unsubscribe still invokes the result hook. |
| M18 | A status-reentrant release still lets the snapshot request return true. |
| M23 | An obsolete replay setup releases an acquisition before current setup reaches it. |
| M24 | A loader starts a newer replay, yet the obsolete setup releases its next demand. |
| M25 | A rejected released demand's Error remains retained while a peer is pending. |

Three mutants survived the initial companion's 16 tests:

- **M1.** Cleanup inside `loadSubset` reached the generation-mismatch branch:
  a throw-at-branch probe failed one test. Cleanup removes a `starting` demand
  and cancels its tentative acquisition. With M1 deleted, the following demand
  membership check releases that record, the generation check suppresses
  adapter unload, and `requestSnapshot` returns false. The only difference is
  an internal release marker on an unreachable record.
- **M6.** A restart history with two detached demands reached the
  replaced-state branch: a throw-at-branch probe produced an uncaught exception
  from the queued restart setup. With M6 deleted, removed demands are skipped.
  Remaining detached demands fail the current-replay check before acquisition.
  The stale setup's completion check cannot publish after cleanup discarded its
  replay state.
- **M8.** A throw in the `releaseAttempted` true branch remained unreached in
  538 focused subscription, lifecycle, and replay tests. Call-site inspection
  shows logical removal before release, replay detachment before unload,
  cancellation rather than release for tentative acquisitions, and unsubscribe
  copying only active acquisitions before it clears ownership. A nested adapter
  callback cannot acquire the same record through these public paths.

These are bounded equivalence and reach arguments. They are not a request to
remove any production guard. SUBS-09 owns a separate code-weight decision.

## Independent review and product repair

Review of the initial oracle found three legal histories that its green run
missed. Two callbacks can release the requested predicate while a direct
snapshot runs. `onUnoptimized` then performed a fallback read, and snapshot
evaluation still published a row. The original code returned `true` in both
cases. The new matrix cells failed against that code and passed after both
post-callback checks tested demand ownership.

The third history combines a subscription predicate with a requested predicate.
The loader released the original predicate before it returned. The original
code had not yet registered the predicate mapping, so it recorded no unload,
returned `true`, and published a row. A pinned oracle case failed at the exact
unload assertion. Registering the mapping before loader entry makes it pass.

The final companion has 20 passing tests. The three new cases are product-bug
witnesses. The initial 11 mutant kills and three survivor arguments remain
claims about the reviewed head. The final production diff retains all guards
from that mutation sweep.

A later external review described both ownership actions as covered at every
callback phase. Its claim exposed one omitted cell: `status:loadingSubset`
unsubscribe. A controlled probe reached that callback on the repaired head and
observed `false`, no publication, and one exact acquisition unload. The matrix
now preserves that already-correct history as its tenth cell.

## Oracle guide review

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The existing lifecycle grammar and Collection cleanup/replay contract authorize the ownership, status, and publication laws above. The companion's limits are stated above and in the coverage map. |
| ORC-002 | Expected results come from owner retirement, sync-run fencing, and resource symmetry. The assertions do not call production classifiers or transition helpers. The M25 retention check observes an internal reference but does not derive its expected value from that field. |
| ORC-003 | The contract and expected law appear in the companion's opening prose; the bounded snapshot matrix is in the lifecycle grammar; each test drives a real Collection; assertions name the return, callback, resource, or microtask checkpoint. Replay histories are pinned in the companion. |
| ORC-004 | Not triggered: the matrix is bounded enumeration, not an important generated property. It reconstructs ten callback/action cells shown in the grammar. A separate case crosses loader reentry with a combined predicate. The existing generated lifecycle owner retains its fixed and random campaigns. |
| ORC-005 | Positive callback counters, load counts, and nested-replay flags prove reach. Exact return values, callbacks, resource effects, and status are compared at synchronous or queued-microtask cuts. The retention test states its white-box limit. |
| ORC-006 | Eleven separate wrong production mutants failed by assertion. M1 and M6 branch probes reached their guards but the deletion mutants survived. The M8 true-branch probe stayed unreached in 538 focused tests. None of these outcomes was a timeout or setup failure. |
| ORC-007 | Not triggered: this companion adds no important generated property. The primary lifecycle-history owner already runs fixed and random campaigns with direct replay. |
| ORC-008 | Not triggered: no state was added to or removed from the pure lifecycle reducer. Callback phase and action are bounded scenario inputs, not a new state machine. |
| ORC-009 | The companion uses the glossary's logical demand, acquisition, sync run, replay, cleanup, settlement, and publication terms. Callback phase is a test schedule cut, not production state. |
| ORC-010 | No shrinking or capture layer was added. The test adapters do not throw during unload or cleanup; `finally` retires every subscription and Collection and settles held promises. A future throwing-cleanup scenario needs separate primary and cleanup diagnostics. |
| ORC-011 | The direct predicate-release fixture and result-hook release token exercise ownership through different entry points. Loader, result-hook, status, unoptimized fallback, and snapshot-evaluation reentry challenge the same no-stale-snapshot law. The combined-predicate loader case crosses predicate identity with reentry. No second provider implementation is claimed. |

The coverage map owns remaining callback combinations and the SUBS-09 decision.
The 11 killed mutants establish sensitivity at the stated checkpoints; they do
not prove the full legal history space.
