# PR #2078: origin attribution and refused insert review

Review target: `a4e6acd33dbb41ca220541ef21414efb3fbbb5ce` against
`2c98b4992c412820f8476325ee6941db5ca9ac0f`. The eight external findings
were supplied in source order. The repair and executable oracle revision is
`43608b4f94a845de3e8d8be2373c42b0ab65efb7`. This record follows that
commit; it does not change its executable code. The private issue #2071 bridge
history remains unavailable and is not treated as refuted.

## Finding ledger

| ID | Reviewed claim | Evidence and technical verdict | Disposition and durable destination |
| --- | --- | --- | --- |
| F01 | `$origin` text omits pending transactions; a same-key source row can stay local after pending rollback, without truncate. | True. A manual pending transaction does not hold source commits. Four controlled cells cross optimistic visibility and fulfillment/rollback, and compare origin at source publication and settlement. | **fixed-now**: API comments, glossary, guide, both reference pages, and the primary optimistic-history model. |
| F02 | `pendingLocalChanges` says persisting, but includes pending. | True by the `overlayActiveTransactions()` state predicate and F01's public witness. | **fixed-now**: production comment names pending and persisting. |
| F03 | A truncate's retained origin leaks to a later same-key transaction in the same drain. | True product bug. The new reentrant history was RED on the reviewed production code: at failed-mutation settlement, the model expected `remote` and the public row was `local`. A one-transaction control passed. | **fixed-now**: scope retained snapshots to each sync transaction in `state.ts`; the same oracle is GREEN. |
| F04 | The source-batch model cannot express delete then reinsert within one transaction, and its opening omits that limit. | True on the reviewed head. The grammar now preserves mixed source operation order, and the opening states the default and ordered lanes. | **fixed-now**: primary model/driver and atomic versus later-transaction witnesses. |
| F05 | The real SQLite test claims an update but writes an insert. | True. The original continuation had insert, delete, insert. It now writes a real `update` and checks adapter forwarding, live/base/durable rows, and reopen. | **fixed-now**: real adapter receiving witness and accurate comment. |
| F06 | `cleanupRealWitness` duplicates `cleanupPersistedOracle`. | Substantially true shared loop, though the latter also enforces a 250 ms limit per action. | **fixed-now**: one `test-cleanup.ts` helper; the persisted owner keeps its timeout wrapper. |
| F07 | The first Collection is cleaned twice; a failure may remove the directory before resources settle. | The double call was true. The claimed open SQLite handle was not established: this witness uses a CLI driver with one process per operation. The old finalizer still attempted directory removal after cleanup failure. | **fixed-now**: track both Collections' successful cleanup and remove the directory only after both release; retain the primary failure and cleanup diagnostics. |
| F08 | The guide's timing rules leave overlapping same-key mutations unspecified while the oracle stays green. | The coverage gap is true. The guide already qualified its first-transaction rule to one mutation without truncate, so it did not promise every overlap. Sixteen bounded histories now cross two active same-key mutations, one/two queued source transactions, both settlement orders, and all success/failure pairs. | **fixed-now** for that bounded gap: guide, model, publication driver, and coverage map. Broader overlap schedules remain explicitly outside the closure claim. |

The original review had eight items. All eight received an in-PR action. F07's
open-handle mechanism and F08's claim of an unqualified guide promise were
overstated; those qualifications do not erase their useful findings.

## Laws and enforcement

### L1. Active local keys and pending settlement (F01, F02)

Authority: the key-and-timing `$origin` contract in `virtual-props.ts` and the
glossary. A pending manual local transaction is active before its mutation
function starts. A same-key source commit applies immediately, may receive
local attribution, and keeps that origin after the manual transaction rolls
back. The source identity is unknown. The old model had only `persisting`,
`completed`, and `failed`, so its grammar could not reach the reported cut.

The model now distinguishes `pending` from `persisting`: the same source commit
applies immediately in the former state and queues in the latter. The driver
uses public `createTransaction({ autoCommit: false })`, `mutate`, sync writes,
`commit` or `rollback`, and Collection reads. Four cells cross optimistic
visibility and success/failure. After each step, the shared driver compares
public rows and origin, both subscriber replicas, downstream rows, request
outcomes, and complete publication cuts. A temporary production mutant that
required `hasPersistingTransaction()` before consulting `pendingLocalChanges`
reached the source and settlement cuts and failed all four cells. It was
restored before the executable commit. This establishes the bounded manual
one-key path, not every pending and persisting overlap.

### L2. Truncate attribution ends with its own source transaction (F03)

Authority: the existing per-atomic-transaction attribution contract and the
truncate comment in `state.ts`. A subscriber can submit a truncate and a later
same-key source transaction while core drains an earlier truncate. Those
accepted suffix transactions apply in source order during the next drain.
Attribution retained for the truncate must not color the later transaction.

The old driver could only commit one source batch at a time, so a truncate
drained before it could queue a successor in the same drain. The new reentrant
step commits both from a real Collection subscriber. The independent model
queues the suffix and snapshots attribution for each batch. The one-batch
control expects local attribution; the two-batch history expects remote for
the later row. On the original production branch, the second history failed
at the public row observed when `isPersisted` rejected: expected `remote`, got
`local`. Moving the retained sets inside the transaction loop made both
histories pass. The driver also checks event replicas and downstream state.
Coverage is one active mutation, two truncates, and zero or one later same-key
transaction; arbitrary reentrant suffixes are not claimed.

### L3. Ordered operations retain one atomic origin (F04)

Authority: a sync transaction is the `begin()`/`commit()` atomic batch, and
the existing first-transaction origin law. The model's `row` action is a
grammar abstraction over source insert/update; the driver selects the source
write kind from its own key membership. The model does not import that driver
classifier. Ordered operations now represent delete then reinsert in one
batch. The model snapshots origin at batch start, consumes it for later
transactions, and derives expected rows independently of production caches.

The fixed witness reaches the real sync path with delete then reinsert of an
existing key. A neighboring history adds a later same-key transaction. Public
origin at successful settlement is local in the atomic-only case and remote
after the later transaction. A temporary production mutant that omitted a
delete from the batch-local attribution set failed the atomic-only witness at
settlement, while the later-transaction control passed. The ordered grammar
rejects mixed `operations` with `rows`/`deletes` and more than one copy. Other
mixed operation sequences are representable but not exhaustively sampled.

### L4. Successful overlapping mutations preserve one key grant (F08)

Authority: queued source attribution is by key and timing, not by source
author or one grant per optimistic transaction. If two same-key mutations are
both persisting before a source transaction queues, a successful mutation
retains one attribution for the key even if its sibling fails. Two failures
retain none. The first same-key source transaction consumes that grant; a
second source transaction is remote without another local owner.

The model already represented multiple persisting transactions but had no
distinguishing overlap campaign. Sixteen bounded histories now cross the two
outcomes, settlement order, and one/two source transactions. The core driver
compares public origin at each settlement, full event cuts, and downstream
rows. A temporary production mutant clearing `pendingLocalOrigins` whenever a
failed sibling remained failed four one-success/one-source cells at the
settlement read, while two-failure controls passed. The tested histories do
not include pending plus persisting overlap, multiple keys, truncate during
overlap, or all possible handler schedules. The coverage map retains those
limits; no universal overlap proof is claimed.

### L5. Real SQLite receives source updates after refusal (F05, F07)

Authority: accepted source transactions must reach the Collection and its
durable persisted replica; a rejected local insert contributes no durable row.
The real SQLite witness holds outbound rejection, accepts a same-key delete,
then follows one of two histories. The continuation now inserts, deletes,
reinserts, and updates through `SyncConfig.write`. It checks live and exposed
base rows, `applyCommittedTx`'s update mutation, durable `loadSubset`, and a
fresh Collection/adapter/driver reopened over the same file. A temporary
adapter mutant dropped only the final update before durable application. It
reached the new update cut and failed the durable-row comparison: SQLite kept
`later source row` instead of `updated source row`. The original broad mutant
also dropped an earlier source turn and failed too early; that result is not
counted as update calibration. The receiving witness uses a SQLite CLI driver
and a same-process reopen; other hosts and a process restart remain outside.

## Oracle-guide check

| Requirement | Result |
| --- | --- |
| ORC-001 authority and limits | L1–L5 name the contract and finite path limits. The private bridge remains unknown. |
| ORC-002 independent judgment | The model derives rows and origin from source actions and key ownership, without production caches or classifiers. The shared `sourceOperations` function only expands grammar order. |
| ORC-003 responsibilities | Opening prose states laws and limits; `HistoryModel`, `OptimisticStep`, the real Collection driver, and `check()` keep model, grammar, path, and refinement distinct. |
| ORC-004 grammar controls | Pending versus persisting, one versus two queued source transactions, batch versus transaction boundary, and both settlement orders have reconstructing witnesses. Bounded domains are above. The driver rejects an ordered batch mixed with legacy rows/deletes or multiple copies, and a reentrant trigger without truncate. Other legal schedules remain listed. |
| ORC-005 path and observation | Public Collection writes, sync callbacks, subscription replicas, downstream rows, receipts, and settlement-time reads reach the named cuts. The real adapter path checks durable and reopened rows. |
| ORC-006 calibration | The original production code and four targeted hostile edits fail assertions at the intended public cuts. The too-broad SQLite edit failed early and is excluded from the update claim. No timeout or setup error is counted as a kill. |
| ORC-007 fixed/random parity | Not triggered by the new bounded enumerations and fixed histories. Existing generated campaigns in the owner retain their prior configuration. |
| ORC-008 model minimality | Pending differs from persisting because sync applies now versus waits. Source operation order and a combined reentrant drain change legal next observations. |
| ORC-009 vocabulary | `pending`, `persisting`, sync transaction, publication, and settlement match the glossary. The model-only `row` action combines source insert/update as stated in the opening. |
| ORC-010 failure fidelity | The core owner keeps its primary failure through cleanup. The SQLite owners now share cleanup aggregation; the persisted owner still bounds each stage, and the real witness releases Collections before directory removal. |
| ORC-011 second formulation | Atomic delete/reinsert versus a later transaction challenges batch-boundary semantics. Causal source authorship cannot be independently decided without a source identity signal; no such guarantee is claimed. |
| ORC-012 review evidence | This record binds original head, executable revision, RED/GREEN, mutants, finite closure, and remaining cells. |
| ORC-013 distinguishing boundary | One versus two source transactions, one versus two reentrant suffix batches, pending versus persisting, and one/two overlapping outcomes distinguish plausible wrong timing rules at public cuts. |
| ORC-014 controlled handoff | The real SQLite receiver tests the controlled refused-insert and source-update premise. The core reentrant history is a core claim, not claimed as real-provider coverage. |

## Verification and limits

On the executable revision, 166 core optimistic history and state-retention
tests passed; the commit-hook rerun passed 61 core publication and outcome tests.
The relevant persisted and real SQLite run passed 18 tests, with unrelated
persisted cases filtered. Vitest's test type checks passed. Prettier and the
changed-file ESLint run had no errors; ESLint reported pre-existing warnings
in the large persisted oracle, and one new shadow warning was repaired before
commit. Git's commit hook ran ESLint fixes; the two focused suites were rerun
after the commit. The production diff in `state.ts` is seven added and six
removed lines, including the corrected comment.

The issue #2071 bridge sequence is still unavailable. This review does not
claim to close its private path, every overlap schedule, every mixed source
batch, another SQLite host, or process restart. The optimistic-history owner
can represent mixed source order and bounded reentry; a bridge-specific
counterexample needs the callback/write sequence and a persisted-wrapper
receiving witness. The coverage map names those limits. No authorized in-scope
repair from these eight findings is left open.

Final accounting: **8 raw items = 8 fixed-now**. F07 and F08 include the
technical qualifications recorded above; neither was dropped from the ledger.

## Post-audit CI and review follow-ups

The full `db-2` CI shard on `00fcf0f` passed 5,901 runtime tests but reported a
test type error at `optimistic-history-oracle.ts:987`: the new manual
`Transaction<HistoryRow>` was missing from the driver's transaction union.
Commit `9cb0e9998ba7fc4f8bb67f2ddc6c45e58717c24b` adds that type. The
package test TypeScript check and 42 origin-publication tests, including their
Vitest type check, pass locally. This change does not alter the model or
production behavior.

CodeRabbit then reviewed `00fcf0f` and posted two actionable documentation
comments. Both were correct. The earlier issue #2071 review record used present
tense for the source-batch grammar's former delete/reinsert limit; its affected
statements now name the historical commit and point to the ordered-batch witness
added in this PR. The generated `VirtualRowProps` and `VirtualOrigin` reference
pages linked to old source line numbers; all seven declaration links now match
`virtual-props.ts`. These follow-ups do not change the eight-item accounting
above. All reported CI checks passed on `e659d413e0f52fa0f9d800fb1d5a41ca784199c3`.

CodeRabbit's next review, [5459093045](https://github.com/TanStack/db/pull/2078#pullrequestreview-5459093045),
checked that head and found an oracle harness defect. Its three findings across
both reviews are accounted for separately from the user's eight findings:

| ID | Claim | Verdict and evidence | PR action and durable value |
| --- | --- | --- | --- |
| CR1 | The earlier #2071 review record still claimed that delete then reinsert was outside the source-batch grammar. | Correct on `00fcf0f`; the ordered grammar and coverage-map witness existed by that commit. | **fixed-now** in `e659d413e`; historical wording now identifies the earlier limit and later witness. |
| CR2 | Six `VirtualRowProps` anchors and one `VirtualOrigin` anchor pointed into source comments. | Correct on `00fcf0f`; all seven current anchors match the declarations at lines 74, 85, 104, 133, 141, 149, and 36. | **fixed-now** in `e659d413e`; generated reference links were corrected. |
| CR3 | A rejected pending manual transaction never starts its handler, so its `isPersisted` promise and oracle cleanup can remain pending. Commit the transaction after rejecting its handler promise. | Correct on `e659d413e`. Two source-row histories and one later-edit history failed at the settlement row assertion after the test first made cleanup safe. The proposed single-line fix alone leaves a later-edit history pending because the shared `starting` variable points to the later request. | **fixed-now** in this follow-up: commit the rejected manual request, bind each manual handler to its own deferred result, and release any still-active transaction during cleanup. The primary oracle and coverage map retain the law and limits. |

The reviewer's three findings were accurate and focused. The proposed fix for
CR3 identified the missing commit but did not account for a later edit replacing
the shared deferred promise. The reviews distinguished documentation defects
from a test-integrity defect and had little noise. Adjacent interleavings
still need checking before accepting the proposed patch verbatim.

### CR3 law, reach, and calibration

A pending manual optimistic transaction starts its mutation function only when
committed. Handler rejection must roll it back, reject `isPersisted` with the
same reason, and expose the applied source row after dropping any optimistic
overlay. This follows from the optimistic transaction and settlement entries in
the glossary and from `Transaction.commit()`/`rollback()`. The production path
is `createTransaction({ autoCommit: false })` → `mutate()` → `commit()` → the
controlled handler promise → `isPersisted`. The model already represented
pending, persisting, and failed transactions. Its grammar could select a
rejection but the pending fixed witnesses selected only success or direct
rollback. The driver did not commit on rejection, and cleanup tried rollback
only when the expected result was still pending.

The expanded fixed matrix crosses optimistic visibility with success, direct
rollback, and handler rejection after a same-key source insert. A second pair
starts a later disjoint edit before the manual request succeeds or rejects.
After each step, the driver checks public rows, origin and pending-write
metadata, subscriber replicas, downstream rows, request outcome and reason,
and publication cuts. At settlement it also checks the rows captured when
`isPersisted` settles. The source-row and later-edit rejection cases failed at
that settlement assertion on the reviewed harness. They were assertion
failures, not Vitest timeouts; cleanup preserved the primary mismatch and
released the pending transaction. With the commit fix in place, temporarily
restoring the shared handler made both later-edit cases fail at the same
assertion. Binding the manual handler to its own deferred result makes all
eight targeted cases pass. This calibrates both the original omission and the
plausible one-line repair that misses an adjacent legal history.

This establishes the bounded law for the named manual histories through the
core Collection path and public settlement, row, and publication checkpoints.
It does not prove longer manual interleavings, same-key cascades, or a persisted
adapter path. The coverage map keeps those limits under the optimistic history
owner. CR3 changes the oracle driver and its fixed histories, not the product
implementation or model state.

| Guide requirement | CR3 evidence |
| --- | --- |
| ORC-001/003 | The oracle's opening states the manual settlement law and limits; the model, grammar, driver, and per-step comparison remain distinct. |
| ORC-002 | The reference transition remains independent of transaction implementation; no expected state was copied from the new driver. |
| ORC-004/007 | The new cases are bounded fixed histories; generated grammar and fixed/random campaigns did not change. |
| ORC-005/006 | Real core transactions reach `isPersisted` and public rows. Original and shared-handler variants fail at the intended settlement assertion; the repaired driver passes. |
| ORC-008/009 | Model state did not change. `pending`, `persisting`, `failed`, and settlement retain glossary meanings. |
| ORC-010 | Cleanup rolls back a still-active transaction regardless of expected outcome; the original assertion remains the aggregate cause, with secondary diagnostics retained. The deferred rejection has a handler before a manual commit starts. |
| ORC-011 | No plausible shared semantic fault between production and model was identified; this review concerned the production driver's ability to reach the modeled outcome. |
| ORC-012/013 | This record binds the reviewed head, RED/GREEN cuts, hostile variant, neighboring success/rollback cases, and remaining limits. |
| ORC-014 | The claim is limited to the core Collection path and makes no real-provider handoff claim. |

Final CodeRabbit accounting: **3 raw findings = 3 fixed-now**. There are no
deferred or design-decision items. The original user's eight-item audit remains
**8 raw = 8 fixed-now**; the unknown private #2071 bridge sequence remains an
evidence limit, not a CodeRabbit item.

## Subsequent nine-finding review of `e659d413e`

The external medium-effort review examined `e659d413e0f52fa0f9d800fb1d5a41ca784199c3`
by reading code; it reported no executed checks. Evaluation began on
`ee21b1797eb7cfc9dfa18a05637477a10de67828`, which had already repaired
the manual-transaction defects in M04 and M05. The nine numbered findings are
all the review's claims; its closing remarks add context, not a tenth item.

| ID | Review claim and proposed repair | Technical verdict and evidence | PR disposition and durable value |
| --- | --- | --- | --- |
| M01 | A truncate on key 1 clears active attribution for untouched key 2; a later key 2 source transaction in the same drain becomes remote. | **Correct, high severity.** A real subscriber committed a truncate suffix and later key 2 write while an edit on key 2 remained active. The public row was remote where the independent model required local. Both publication and settlement variants failed on the reviewed production logic. | **fixed-now.** Preserve active keys across truncate; the primary optimistic-history oracle owns the origin law. |
| M02 | Clearing `pendingLocalChanges` on truncate caused M01; keep it and remove the temporary origin snapshots. | **Correct.** The snapshot copies covered only the truncate transaction. Removing the clear and snapshots preserves untouched active keys while existing same-key controls still consume attribution. | **fixed-now.** The production change removes the per-transaction snapshots and clears only row origins, completed attribution, and the virtual-props cache at truncate. |
| M03 | The reentrant grammar never wrote a later different key with an active edit. | **Correct coverage gap.** The former fixed histories wrote key 1 only. The new key 2 history failed on the original production logic at the promised public cuts. | **fixed-now.** Two optimistic-visibility variants join the primary publication owner; the coverage map names the bounded shape. |
| M04 | A pending manual transaction's shared handler could take a later edit's deferred result. | **Correct at the reviewed head; already fixed** in `ee21b1797`. The prior review record documents a later-edit RED settlement assertion and a hostile shared-handler variant; the current driver binds its own deferred. | **already-fixed.** Preserve the later-edit witness and settlement law in the optimistic-history owner. |
| M05 | Rejection of a pending manual request never commits it, so the model fails it while production stays pending. | **Correct at the reviewed head; already fixed** in `ee21b1797`. The prior RED assertion and current guarded rejection, commit, and cleanup are recorded above. | **already-fixed.** Preserve success, direct rollback, and rejection cases; no second patch to the handler was needed. |
| M06 | The no-cascade model comment is false for a failed same-key edit and pending manual peer. | **Correct.** Explicit cascading rollback and handler rejection made production reject the peer while the old model kept its overlay. The mismatch reached settlement, not a timeout. | **fixed-now.** The model cancels pending same-key peers; six cases distinguish same/different keys, cascading/secondary rollback, and handler rejection. |
| M07 | The real SQLite test rejects an outbound promise that no handler observes if setup fails before insert. | **Correct.** A temporary pre-insert failure produced both the intended error and a Vitest unhandled rejection. The same injection after the guard preserved only the primary failure. | **fixed-now.** Reject outbound only once a transaction exists; this protects test failure fidelity. |
| M08 | The model keeps active keys through truncate while production clears them, without explaining the difference. | **Correct explanatory and implementation gap.** The model's active-key rule was the independent expected behavior that exposed M01; its comment did not distinguish active from completed attribution. | **fixed-now.** Opening and local model prose now explain why untouched active keys survive and completed one-use attribution ends. |
| M09 | The origin contract is repeated across source, glossary, guide, and generated reference pages and had drifted. | **Correct.** The same detailed paragraph appeared six times. The generated reference copy also stated the broken drain rule. | **fixed-now.** `VirtualOrigin` source prose is the detailed contract; the interface, glossary, and guide summarize and link to its generated reference entry. Five affected reference pages carry the regenerated text and corrected source anchors. |

No original severity labels were supplied. M01 is the release-relevant product
regression; M03, M04, M05, M06, and M08 concern oracle reach or judgment; M07
concerns test failure fidelity; M09 concerns contract drift. The reviewer was
technically accurate on all nine items at the reviewed commit and found the
interaction between the prior fix and active-key ownership. The proposed M02
repair was both correct and smaller than the snapshot approach. The review
did not report execution, so its failure claims needed the probes above.

### Laws, reachable histories, and enforcement

**L6: Truncate preserves active attribution for untouched keys (M01–M03,
M08–M09).** The public `VirtualOrigin` contract and the existing key-and-timing
model require a source write on an active local mutation's key to be local
until a source operation consumes that key. A truncate ends completed one-use
attribution, but an active mutation on a key the truncate omits is still active.
The old production clear contradicted this law. The old oracle lacked the
different-key suffix, so it never distinguished the clear from the model.
The independent model retains active keys until a source operation touches
them and clears completed grants at truncate. The legal fixed history has one
active edit on key 2, a subscriber-triggering truncate, a second truncate
writing key 1, then a non-truncate key 2 source transaction in the same drain.
Both optimistic and nonoptimistic edit visibility are tested. The existing
later same-key suffix controls the opposite boundary: a key written by the
truncate loses attribution for a later transaction. The real Collection sync
driver compares public rows and origin, both subscriber replicas, downstream
rows, outcomes, and complete publication cuts after each step. On the old
implementation, the nonoptimistic case failed at source publication and the
optimistic case failed when the failed edit's `isPersisted` settled: actual
`remote`, expected `local`. Those are assertion failures at the intended
cuts. The repaired code passes both and the same-key controls. This closes the
two-key, one-active-edit, two-suffix-batch core boundary tested here; it does
not establish every longer reentrant drain or provider bridge sequence.

**L7: A cascading failure cancels a pending same-key peer (M06).** Public
transaction settlement and the established same-key conflict rule require a
pending manual peer to reject when a failing edit cascades rollback to it.
A different-key peer, an already persisting peer, or a secondary rollback
does not acquire that outcome from this failure. The old model comment and
transition wrongly omitted the pending-peer cancellation, allowing false
failures against correct production behavior. The model now uses its own
one-Collection key equality and pending state to derive the canceled peers;
it does not import the production conflict helper. The six fixed histories
cross same/different keys with direct cascading rollback, secondary rollback,
and handler rejection. They run real `createTransaction({ autoCommit: false })`,
`mutate`, `commit` or `rollback`, and `isPersisted`. Each step compares
visible rows, origin, event replicas, downstream rows, request outcomes, and
publication cuts. The old no-cascade model failed at settlement in the
same-key cases; the corrected model passes all six, while the different-key
and secondary controls distinguish overbroad cancellation. This closes the
two-request pending-peer boundary tested here, not arbitrary conflict graphs.

**L8: A pending manual request settles by its own handler (M04–M05).** The
contract, grammar, core path, settlement observations, original RED results,
shared-handler hostile control, and remaining longer-history limit are
documented under CR3 above. This review rechecked that the current driver
still uses that path and that its focused suite remains green. M04 and M05
were true of `e659d413e` but required no new repair after `ee21b1797`.

M07 needed a controlled failure injection, not a product model: the test
cleanup must not create an unhandled rejection that masks its primary setup
failure. M09 needed direct source comparison, TypeDoc output, and working
relative links, not a state oracle. The five generated reference pages contain
one detailed contract in `VirtualOrigin` and summaries elsewhere; their
source anchors match the current declarations.

### Oracle-guide audit and verification

| Requirement | Outcome for this review |
| --- | --- |
| ORC-001/003 | L6–L8 state authority, finite limits, model rules, grammar, production path, and comparison cuts beside the executable owner. The canonical origin prose and coverage map were updated with the executable law. |
| ORC-002/008/009 | The model retains active keys independently of production tracking and distinguishes pending from persisting. Cancellation uses model key/state, not the production helper. The model-only row action and public terms remain mapped in the opening. |
| ORC-004/013 | The new key 2 suffix reconstructs the reported trace; same-key later-write and both visibility modes distinguish wrong boundaries. The six peer histories ablate key equality and cascade mode. The existing grammar rejects a reentrant suffix without truncate. Domains and longer-history limits are explicit above and in the coverage map. |
| ORC-005/006 | Original truncate logic and old no-cascade model failed assertions at named public cuts. The earlier manual-handler omissions and shared-handler mutant failed at settlement. No timeout, setup error, or mere path reach is counted as a kill. |
| ORC-007 | The additions are bounded fixed histories, not a new important generated property. Existing generated campaigns were not changed. |
| ORC-010 | The real SQLite pre-insert injection separated its primary error from the unhandled rejection; the guard removed the latter. Existing cleanup aggregation still preserves primary history failures. |
| ORC-011 | No new shared semantic fault between production and the independent model was identified, so a second formulation is not triggered. Same-key and different-key controls test the boundary; no new real-provider equivalence is claimed. |
| ORC-012/014 | This record binds the reviewed head and RED/GREEN evidence. The core reentrant claim stays at the core Collection boundary; the private bridge still needs its callback/write sequence and a persisted receiver. |

After the repair, 241 core tests passed across optimistic publication,
outcomes, state retention, and truncate readiness, with no test type errors.
The SQLite real-adapter and persisted oracle run passed 869 tests with two
existing todo tests and no test type errors. The doc generator emitted the five
relevant reference pages, but also produced unrelated changes because several
package dependencies were unavailable; those unrelated changes were not part
of this repair. The focused source and link checks found no stale repeated
origin paragraph or invalid `VirtualOrigin` relative link.

Final loss audit for this review: **9 raw items = 7 fixed-now + 2
already-fixed**. There are no refutations, accepted-design items, design
decisions, or agreed deferrals. The reviewed claims are accounted for and
the authorized bounded repairs are complete. No universal claim is made for
longer reentrant suffixes, larger rollback conflict graphs, other SQLite
hosts, or the unavailable private #2071 bridge sequence; their executable
owners and needed witnesses remain in the coverage map.

### CodeRabbit review of `ee21b1797`

[Review 5460095613](https://github.com/TanStack/db/pull/2078#pullrequestreview-5460095613)
contained one outside-diff behavior suggestion and one inline documentation
suggestion. Both are accounted for here; its suggested agent prompts and local
tool invocation are review metadata, not additional findings.

| ID | Claim and proposed action | Evidence and technical verdict | Disposition and durable value |
| --- | --- | --- | --- |
| CR4 | The model keeps `activeKeys` after an empty truncate while production clears its active-key tracking; clear `activeKeys` after taking the batch snapshot. | Production did clear active tracking on the reviewed `ee21b1797`, so the observation was accurate there. Its proposed model change contradicts the `VirtualOrigin` active-key law and would make the model accept M01's product regression. After the production repair at `a109687c1`, that change was run as a temporary model mutant. Both new key 2 cases failed at their intended public cuts: the nonoptimistic case at complete source publication and the optimistic case at `isPersisted` settlement. The mutant was removed. | **stale** as a production/model mismatch after M01's repair; **refuted** as a model repair. Keep the empty-truncate/different-key challenge under the optimistic-history owner. |
| CR5 | Remove a hiring recommendation from the engineering review record. | Correct maintainability point: the durable record needs code and test evidence; the user-facing review can carry the requested reviewer assessment. | **fixed-now.** Removed the personnel recommendation from this record while retaining the technical quality assessment and all law evidence. |

CodeRabbit accounting for this review: **2 raw items = 1 stale with a refuted
repair + 1 fixed-now**. CR4's historical observation and useful adversarial
history remain recorded; no product law or test coverage was weakened to
accept the proposed model change.

### Merge-readiness self-review after green CI

The public origin prose said that a later same-key transaction after a
truncate is remote without specifying the drain boundary. The existing
reentrant witness has a trigger and suffix truncate in separate drains. The
still-active mutation can attribute the suffix truncate again. A later
same-key transaction within the suffix drain is remote. The source comment,
generated reference, oracle opening, publication comment, and coverage map
now state that narrower rule. This is a contract wording correction, not a
production change.

Two temporary legal-history probes also crossed a pending and persisting
same-key pair with a reentrant truncate, and two active keys with that drain.
Both passed the core public-history comparison and test type check. The probes
were removed. They support those two sampled schedules but do not close the
coverage map's longer overlap or provider-path limits.
