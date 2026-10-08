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
above. The new CI run is pending at the time of this note.
