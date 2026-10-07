# PR #2062 follow-up review at 629c836

Reviewed product commit: `629c83609d726a0a1e52c7838992594703394f05`.
The source was a nine-item medium-effort code-reading review with no executed
checks. This record keeps its source order and distinguishes the reviewed code,
the local follow-up repair, and questions that remain open. PR #2059's oracle
instrument guidance was read before changing the owning tests. Its distinction
between an observed bug and a chosen policy governs this audit.

## Finding ledger

| ID | Claim | Evidence and technical verdict | PR action and durable value |
| --- | --- | --- | --- |
| R1 | A canceled pending debounce leading transaction can strand a later call. | Confirmed. Direct rollback and same-key cascade both left the third transaction pending at the held-handler release cut. | **fixed-now locally**: track the pending leading transaction's identity. Both histories now start writes 1 and 3 and settle the third receipt. |
| R2 | A restoration subscriber writes into the failed transaction because its context remains ambient. | Confirmed. The original handler payload included subscriber row 3 after the failed callback's snapshot had been restored. | **fixed-now locally**: remove the failed callback's ambient frame before restoration publishes. Nested success and failure neighbors retain an enclosing callback's context. |
| R3 | A throwing outer `onMutate` can erase an admitted nested call while its receipt fulfills. | Confirmed. Debounce and throttle failed the nested receipt/backend-intent implication; the earlier-pending neighbor remained red after the first cleanup repair. | **fixed-now locally**: the user chose group rejection. Every receipt sharing the pending transaction rejects with the callback error, including an earlier call; a later independent call persists. Both factories pass fresh and earlier-pending histories. |
| R4 | Throwing `onMutate` retains a newly created empty pending transaction in its scope. | Confirmed by the scope-retention witness for admitted and dropped debounce calls, plus the adjacent queue path. All three were pending on the reviewed implementation. | **fixed-now locally**: roll back the newly created transaction and preserve the callback error. The three witnesses pass; this cleanup alone does not close R3. |
| R5 | Sharing one strategy instance across managers can lose another manager's reentrant write. | Confirmed. The two-manager probe and primary oracle both left the second receipt pending with no second backend start. The user chose to preserve one shared timing boundary and separate transaction receipts. | **fixed-now locally**: pending callbacks are keyed by transaction while the timer and serial pacer remain shared. Reentrant leading/trailing, ordinary trailing, renewed quiet, and held-handler rollback histories now settle both managers' work without overlap. |
| R6 | A manual early commit makes a later strategy timer throw globally. | Confirmed. The original manual commit started persistence, and its debounce timer later threw. A held-handler oracle failed the manual-guard cut for debounce, throttle, and queue. | **fixed-now locally**: the user chose strategy-owned commit. Manual `commit()` throws before state changes; the scheduled write still waits for its timer and prior handler. All three strategy witnesses pass. |
| R7 | Eager mutation-array snapshots add quadratic work over many calls. | Confirmed: five no-op calls with 16 prior mutations made 80 snapshot-entry visits on the reviewed code. `applyMutations` already traverses prior mutations for every real write, and catch-only copying cannot recover earlier merges. | **fixed-now locally for the added copy**: capture the prior array only before the callback's first `applyMutations`. The same counter now records zero visits for five no-op calls; the atomicity owner still passes. Real writes retain the pre-existing linear merge traversal, so long sequences remain quadratic overall. |
| R8 | The old issue-2058 review record incorrectly certifies current code. | The old record explicitly pins `632e46944` and limits its no-counterexample statement to a named grammar. R1 is outside that grammar, so the historical statement is not a current-head certification. | **stale as phrased**: preserve the old record and add this revision-bound audit. The coverage map now names the new histories and the reachable R3 gap. |
| R9 | A single-use throttle helper and debounce return branches should be shortened. | The helper is single-use, but an attempted inline check was narrowed to `undefined` across reentrant `onAdmit`; ESLint marked the branch unnecessary. A fresh helper read preserves the intended reentry observation. The ternary has no clarity gain. | **refuted as a useful cleanup**: retain the helper and explicit debounce branches. |

## Law, reach, and calibration

For R1, the guide's admitted-call persistence obligation and one-persisting
bound are judged by the paced owner. The legal history holds write 1, admits
write 2 into a pending leading slot, cancels it directly or through same-key
rollback, then admits write 3. The driver checks optimistic row 3 at admission,
only write 1 at the quiet edge, writes 1 and 3 after release, and all three
receipt outcomes. The reviewed implementation fails the backend-start assertion;
the ownership repair passes both histories. Longer arbitrary bursts and shared
manager state remain outside this finite calibration.

For R2, the manual transaction contract says a failed synchronous callback
contributes no lasting intent. The optimistic transaction owner models the
subscriber's restoration-triggered write as a later authoring action. It
observes row 3 in the Collection but requires that the failed transaction's
payload contain no row 3 at the throw and commit cuts. The reviewed
implementation fails the payload assertion; the repair passes. Nested callback
success and failure witnesses check that removing one ambient frame does not
remove an enclosing frame. They do not prove arbitrary subscriber reentry or
cross-scope restoration.

For R3, the user chose group rejection for paced reentry. Calls merged into
one pending transaction share its optimistic lifetime and settlement. The
paced owner checks both factories with a fresh transaction and with an earlier
pending call. At the throw cut, every group receipt rejects with the callback
error and no group row remains visible. At the scheduled edge, no failed group
member reaches the backend; a later independent call persists. The fresh pair
failed on the reviewed implementation, while the earlier-pending pair failed
on the partial repair. Both pairs pass after the group rollback. Ordinary
manual `Transaction.mutate` still retains successful earlier callbacks; only a
nested paced call that shares the failed group triggers this broader rollback.

For R4, a callback that throws before returning a transaction cannot leave a
newly created empty pending transaction in its scope. The paced owner uses a
scope-retention assertion because the empty object has no Collection row to
observe publicly. The reviewed implementation fails at the post-throw state
assertion for admitted, dropped, and queue paths. The repair passes each path.
This is a resource lifecycle witness, not a claim about real-server timing.

For R6, the user chose strategy-owned commit. The paced owner holds write 1,
admits write 2, and attempts manual commit before its scheduled start. Across
debounce, throttle, and queue, the reviewed path failed the synchronous guard
assertion. The repair leaves transaction 2 pending, starts no overlapping
handler, and later fulfills both receipts after write 1 releases and write 2
becomes eligible. R5 uses the user's shared-timing contract. The paced owner
checks two managers on one strategy through reentrant leading/trailing and
ordinary trailing histories, plus a held first handler rolled back before the
second starts. A renewed-quiet history rejects a plausible partial repair that
leaves an eligible callback from another manager in the serial pacer. That
partial repair starts the callback at time 24 instead of the new time-32 edge.
A shared queue control retains two managers' independent
receipts in queue order. One pending callback slot cannot express this law:
the two transactions cannot merge, and replacing either callback loses its
receipt. The keyed serial-pacer queue is the needed architectural change. The
reviewed code fails the backend-start cut for both
factories; the repair passes. These finite histories do not cover arbitrary
numbers of managers or all queue capacity policies. R7 uses a deterministic
work count: the reviewed code visits 80 prior entries for five no-op callbacks
after 16 writes, while the repair visits none. The optimistic transaction
owner still checks restoration after failed writes, including nested
callbacks. The existing merge path remains linear per real write. R8 and R9 are
source and documentation judgments rather than product oracles.

## Current local checks and limits

The reviewed paced owner passed 134 tests before new histories were added.
R1, R2, R4, and fresh-transaction R3 failed the reviewed behavior at their
intended assertions. Earlier-pending R3 failed the partial repair; manual
commit failed the new guard cut on all three strategies. The local paced and
optimistic owners pass 298 tests. The final full DB package suite passes 8,848
tests in 250 files, with no type errors. Focused ESLint, Prettier, and the DB
package build pass. Published PR checks remain.

The nine source items are accounted for: seven locally repaired, one stale
historical claim, and one refuted cleanup suggestion. Published PR checks
remain before this branch can be called ready for review.

## Reviewer assessment

The review found four reproducible correctness or lifecycle gaps that the
existing tests missed, and it identified two real but policy-dependent paths.
Its strongest contribution is the cancel-then-readmit debounce history. The
performance observation is measurable, but its catch-only remedy would break
atomic restoration. The proposed documentation rewrite overlooks the old
record's revision limit, and the small cleanup suggestion would hide a
reentrant state read. Overall signal is high, with moderate fix quality; I
would accept this reviewer for correctness review while expecting executable
calibration and clearer separation of bugs from product choices.
