# PR #1902 change-event and queued-admission oracle review

## Reviewed state

- Base commit: `f473a36201abe9af43d36a83492a2649668756d8`.
- Original PR head: `8c763b8c531297ec615e157c3669a907a4b6eb59`.
- Corrected implementation head:
  `78786469a0a49db3d9349ac378cb2bce96d09afb`.
- Reviewed change: PR #1902 plus the queue-admission and cancellation repair at
  that corrected implementation head.
- Primary executable owners:
  `packages/db/tests/change-event-history-oracle.test.ts` and
  `packages/db/tests/collection-state-retention-oracle.property.test.ts`.

This record is committed after the implementation it audits so it can name that
immutable tree directly.

## Claim and limits

Issue #1901 and the public change-message contract require a mirror that applies
every settled insert, update, and delete to agree with its Collection. The
bounded change-event oracle owns legal one-key local mutation histories of
length one through four from an absent row. It crosses same-turn batching with
sequential settlement and compares the Collection and mirror at applied
settlement.

Queued source admission is a separate refinement. Duplicate-key validation
uses the authoritative state produced by retained source rows plus earlier
queued sync transactions. If cancellation removes a queued delete, every
remaining transaction is revalidated before application. An insert that has
become a duplicate rejects and cannot replace the retained row. The same rule
rejects a different insert behind an earlier queued insert and a repeated
insert in one sync transaction.

The bounded local history does not establish initially present rows, multiple
keys, persistence failure, callback batch shape, or intermediate publication.
The queued refinement uses controlled in-memory persistence and sync actions.
It does not establish provider transport cancellation, unbounded queue size, or
adapter-specific persistence behavior.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. Issue #1901 records the settled mirror-agreement bug and expected public result. The Collection duplicate-key contract already rejects a different insert for an authoritative key. The executable openings and this record state the limits. |
| ORC-002: independent judgment | Pass. The bounded oracle uses one optional value and a change-message Map. The queued refinement uses retained-key membership and transaction order. Neither imports Collection state classifiers or duplicate-detection helpers. |
| ORC-003: distinguishable responsibilities | Pass. The change-event opening names its contract, optional-value model, bounded grammar, local-only production driver, applied-settlement checkpoint, and omissions. The state-retention owner already separates its source Map, lifecycle driver, and row/event checks. |
| ORC-004: generated-history grammar controls | Pass for the bounded enumeration. The issue witness `insert -> delete -> insert` is reconstructed. Removing batched execution loses the reported same-turn path; sequential execution is the control. The range is one key and lengths one through four. Insert-while-present and update/delete-while-absent are excluded. The queued additions are fixed controlled histories and make no generated-history claim. |
| ORC-005: production path and observation | Pass. The bounded driver calls public local-only mutations and `subscribeChanges`, awaits persistence, and checks public rows plus the mirror. The queued driver uses real sync actions, a held mutation, abort signals, applied receipts, retained source state, and public reads. |
| ORC-006: checker calibration | Pass. On the base, four batched histories failed with `DuplicateKeySyncError`; the PR made all 22 history cells green. A dropped-reinsertion mirror is rejected explicitly. On the original PR head, the controlled abort produced `delete=aborted`, `insert=fulfilled`, and retained/public value `2` instead of `0`. The queued-insert and same-transaction duplicate controls also failed before the follow-up. |
| ORC-007: fixed/random campaigns and replay | Not applicable to the bounded enumeration and fixed controlled histories. The state-retention owner's existing important generated properties retain their fixed/random campaigns and replay interface. |
| ORC-008: stateful-model minimality | Pass. Presence plus the optional row value determines the legal next local action and final expected value. Queued admission additionally retains transaction boundaries because cancellation can remove one transaction atomically. |
| ORC-009: vocabulary mapping | Pass. A sync transaction is the work between `begin()` and `commit()`. Application makes its writes visible. Applied receipts, optimistic transactions, public rows, and change messages retain the glossary meanings. |
| ORC-010: failure fidelity and cleanup | Pass. The RED comparison recorded receipt outcomes and both retained and public values in one observation. Controlled gates release in `finally`; subscriptions and Collections clean up even after assertion failure. |
| ORC-011: independent second formulation | Not applicable. No remaining shared-fault hypothesis requires another formulation. The mirror and direct public read are complementary observations, not claimed as two independent semantic implementations. |

ORC-012 is satisfied by this versioned record, its exact corrected
implementation head, and its link from `docs/contributing/oracle-coverage.md`.

## External-review reconciliation

CodeRabbit correctly found the canceled-delete admission bug. Its proposal to
revalidate the queue was directionally correct. The review did not test two
adjacent regimes: a predecessor that was itself queued, and duplicate inserts
against queued or same-transaction state. The refined oracle preserves those
cases with the original retained-row witness.

The review's security wording was appropriately conditional. The evidence
establishes Collection-local integrity impact for callers able to provide sync
operations and abort timing. It does not establish an authentication bypass,
cross-service exposure, or an untrusted actor with those capabilities.

The vendor docstring warning has no repository-configured 80% threshold and
does not identify a missing product contract. It is not a merge-blocking
finding for this repository.

A follow-up prep review found three additional defects in the first corrected
implementation. Deterministic RED probes measured 2,144 queued-operation
inspections for a 64-row snapshot with a 128-inspection linear allowance,
showed cancellation rejecting both a valid identical echo and a hydration
replacement, and showed abort-before-commit making the active transaction
unaddressable. The corrected implementation uses an incremental queued
projection, replays cancellation through the normal insert classifier, and
retains invalidated active transactions until `commit()` returns their rejected
receipt.

## Verification boundary

The corrected implementation head passed the two primary executable owners and
five adjacent lifecycle, metadata, reconciliation, hydration, and load-subset
owners: 223 tests. The complete DB oracle campaign passed 41 files and 2,197
tests. Package build, TypeScript, changed-file ESLint and Prettier, and
`git diff --check` also passed.

## Follow-up review: mirror-agreement class coverage

- Reviewed test head: `bbde36962534f55d1e0515224ef5bb070ce5aad3`.
- Production remains at the corrected implementation above. This follow-up
  changes only oracle tests, their replay registration, and documentation.
- The change-event owner now executes 366 bounded history cells: all legal
  operation-kind/key histories of lengths one through four for one key from
  absence, and lengths one through three for two keys from each initial-presence
  state. Values are deterministic and distinct by step. Each history runs in
  same-turn and sequential modes. Two 100-run campaigns also
  explore up to twenty legal actions over four keys. One uses seed `1902`; the
  other has no seed unless a direct seed-and-path replay is requested.
- The queued-sync fixture builds its initial mirror from its declared source
  rows. It checks that mirror against complete public rows at every delivered
  callback and after the queued work settles, including canceled predecessors.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. Issue #1901 and the public change-message contract authorize mirror/public agreement. The executable owner limits its claim to local-only persistence and named queued-sync cases; it does not claim arbitrary adapters or unbounded histories. |
| ORC-002: independent judgment | Pass. A plain keyed Map computes expected complete rows from legal actions. A second Map applies delivered change messages. Neither imports Collection merge or change-composition rules. The queued fixture derives its initial mirror from declared input, not from production output. |
| ORC-003: distinguishable responsibilities | Pass. The change-event owner names the contract, keyed Map model, bounded and generated grammar, local-only Collection driver, and callback/settlement comparisons. The queued owner keeps its source model and controlled driver separate. |
| ORC-004: generated-history grammar controls | Pass. The `insert -> delete -> insert` witness is reconstructed. Removing same-turn mode loses the original failure; removing sequential mode loses settled-prefix checks. Initial presence and two keys expose replacement against retained rows and independent-key interactions. Bounded limits are one key/four actions and two keys/three actions. The generated range is four keys/twenty actions. The grammar rejects insert of a present key and update or delete of an absent key. These are local mutation histories, not arbitrary sync-adapter histories. |
| ORC-005: production path and observation | Pass. The driver calls public `insert`, `update`, `delete`, `subscribeChanges`, and public Collection reads. It compares complete keyed row values with the model after persistence, at every sequential prefix, and against the event mirror at every delivered callback. The queued driver checks the same relation at its controlled publication cuts. |
| ORC-006: checker calibration | Pass for the reported fault. A temporary production mutant omitted the absent-key pre-sync value; bounded case `one-key-batched-8` failed at mirror agreement with `[]` against the expected row for key 1. The mutant was removed. Missing, extra, and wrong mirrored rows also fail the comparison control. A separate tentative change-composition mutant survived this witness; branch reach was not established, so it is not counted as a kill. |
| ORC-007: fixed/random campaigns and replay | Pass. The new generated owner runs the identical arbitrary, production driver, recorder, comparison, and 100-run budget with fixed seed `1902` and a seedless campaign. Direct guarded replay with seed `1902` and path `0` selected exactly the named property and recorded one completed witness. The retention owner now runs matching fixed and seedless 100-run campaigns; its direct replay also passed. The optimistic-history fixed campaign now matches its 100-run random budget. |
| ORC-008: stateful-model minimality | Pass. Per-key presence determines legal next actions; per-key row value determines the promised observation. Two states that disagree on either can be distinguished by a legal next action or the next public-row check. The model needs no production queue or publication state. |
| ORC-009: vocabulary mapping | Pass. The local driver waits for optimistic-transaction persistence, not an applied sync receipt. It calls delivered inserts, updates, and deletes change messages and compares the public Collection rows. The Map is a reference model, not a production Collection state. |
| ORC-010: failure fidelity and cleanup | Pass. Both changed drivers retain the primary law failure, collect separate cleanup failures, and release their subscriptions and Collections. The queued driver also releases the held persistence gate. The bounded and generated histories retain their input and checkpoint in the failing test name or fast-check replay. |
| ORC-011: independent second formulation | Not triggered. No identified semantic fault is plausible in both the plain Map transition and the change-message fold. The three-way comparison of model, public rows, and event mirror is complementary evidence, not a claim that two production paths are independent. |

ORC-012 is satisfied for the follow-up by this append-only entry and its exact
reviewed test head. The original review and its older head remain intact.

The two primary owners passed 434 tests. The complete DB oracle campaign passed
41 files and 2,544 tests. TypeScript, changed-file ESLint and Prettier, guarded
seed-and-path replay, and `git diff --check` passed. These checks give bounded
and sampled class-level protection, not a proof over every future schedule or
provider implementation.

## Follow-up review: five queued-sync findings

- Reviewed implementation and test head:
  `d1a38b59b88ee914a212e4fd2581c8b9ac902ed5`.
- Starting head for the external review:
  `d0d76e3bb4645ee1d33faadf40eaf4289d777504`.
- This append-only entry covers all five findings in the user's review. The
  primary queued-sync owner remains
  `packages/db/tests/collection-state-retention-oracle.property.test.ts`.
  Focused `packages/db/tests/db-client.test.ts` cases drive the separate
  DbClient hydration boundary.

| Finding | RED evidence on starting head | GREEN boundary on reviewed head |
| --- | --- | --- |
| R01: refresh recovery | A synthetic committed-invalid queue entry remained queued with its applied receipt pending, and replay returned before assigning the rebuilt projection. Current production refresh callers cannot form this state. | Refresh rejects and retires the invalid entry while retaining a valid queued sibling. A later duplicate classification sees that sibling in the rebuilt projection. This is internal hardening, not a claimed public reach witness. |
| R02: doomed open write | Canceling a queued delete invalidated an open insert. A later insert threw `DuplicateKeySyncError` synchronously from `write()`. | The later write cannot revive the doomed transaction; `commit()` returns the rejected applied receipt. Cancellation reaches the problematic state, even though the review named commit-time refresh. |
| R03: bulk hydration | A late hydration chunk overwrote a queued adapter insert and resurrected a queued adapter delete while a local mutation held application. | Both controlled histories retain adapter authority in source and public rows after applied settlement. `initialData` runs before sync starts, so the review's initial-data variant is not a reachable queued path. Projection-aware row classification alone would not prevent stale hydration from winning; the seed is excluded for keys with committed adapter work. |
| R04: cancellation work | A queue-entry counter saw 2,275 indexed reads for 64 dependent inserts, above the 512-read bound. Counting only operation iteration had falsely passed because each rebuild stopped at the first invalid transaction. | One replay retires all invalid committed dependents. The probe also includes preceding writes inside those dependents and a valid queued sibling; it checks receipts and complete public rows. The changed-key undo avoids cloning the whole projection for each transaction. The counter bounds queue inspection, not every cost of optimistic recomputation. |
| R05: impossible guard | Source control flow returned an invalid transaction only when `committed` was true. The refresh check for `!committed` was unreachable. | The guard is gone; direct source review and static checks validate the cleanup. No artificial product RED is claimed for dead code. |

The missing test dimensions were, respectively: a committed-invalid refresh
recovery state; a write after open-transaction invalidation; hydration while
same-key adapter work was queued; cancellation work rather than admission work;
and a direct control-flow check. The new fixed histories preserve the RED
witnesses. The existing generated histories were not widened by this follow-up.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. The established duplicate-key and applied-receipt contracts govern R01 and R02. The existing late-hydration adapter-authority test governs R03. The queued-work bound protects the PR's incremental-admission design. The synthetic recovery probe is not offered as a current public path, and no test here proves arbitrary provider schedules or total cancellation runtime. |
| ORC-002: independent judgment | Pass. The queued owner derives expected rows from declared source rows and delivered change messages. Focused hydration expectations come from adapter-over-seed authority, not the production classifier. The queue-read counter measures production work but does not compute expected rows. |
| ORC-003: distinguishable responsibilities | Pass. The state-retention owner already states its source Map, legal sync histories, controlled driver, public observations, and applied-settlement checkpoint. The hydration cases are focused boundary regressions rather than a new oracle model. |
| ORC-004: generated-history grammar controls | Not triggered for this follow-up: it adds fixed controlled histories and makes no new generated-grammar claim. The owner's existing generated grammar is unchanged. |
| ORC-005: production path and observation | Pass. The driver calls real sync `begin`/`write`/`commit`, aborts a real signal, and checks applied receipts, public rows, retained source data, and the event mirror. Hydration calls `DbClient.applyCollectionChunk`. R01 is explicitly an internal synthetic-state probe. |
| ORC-006: checker calibration | Pass for the claimed repairs. Each behavioral probe failed on the starting implementation and passed on the reviewed head. The R04 counter killed the repeated-rebuild design at a named work checkpoint; the corrected probe distinguishes queue traversal from early operation-loop termination. R05 uses source evidence, not a product mutant. |
| ORC-007: fixed/random campaigns and replay | Not triggered by the new fixed controls. The existing state-retention fixed and seedless campaigns ran in the package oracle campaign. The direct replay interface is unchanged; its prior checked replay is recorded above. |
| ORC-008: stateful-model minimality | Not triggered: this follow-up does not add or remove reference-model state. The new controlled histories distinguish dependent transactions, valid siblings, and a retained source row without copying the production queue into expected results. |
| ORC-009: vocabulary mapping | Pass. The new cases distinguish sync transactions, optimistic transactions, applied receipts, source rows, hydration seeds, change messages, and public rows. No new model-only production synonym is introduced. |
| ORC-010: failure fidelity and cleanup | Pass. The queued oracle helper preserves the primary mismatch and separate cleanup failures. The synthetic refresh and focused hydration probes now do the same, release their held gates or receipts, and clean up Collections. |
| ORC-011: independent second formulation | Not triggered. The review did not identify a semantic fault plausibly shared by the source Map and change-message mirror for the queued law. Hydration authority is tested against both retained and public rows; these are complementary observations, not claimed independent formulations. |

ORC-012 is satisfied by this append-only review entry, the exact reviewed code
head above, and the coverage-map link. The two edited test files passed 108
tests. The DB oracle campaign passed 41 files and 2,547 tests. Package build,
TypeScript, changed-file ESLint and Prettier, and `git diff --check` passed.

## Follow-up review: applied adapter authority over hydration

- Reviewed implementation and test head:
  `95f5a77cb648f9961bf850f0983dd957c3fbe478`.
- Starting production head: `cc12dea59ce1b81faec4e1b01f5b651e6c0272f3`.
- Primary executable owner:
  `packages/db/tests/db-client-hydration-authority-oracle.test.ts`.

The previous queued-hydration controls did not cross an adapter delete or
truncate **after its applied receipt settled**. A late chunk then restored the
deleted row or the entire truncated snapshot. The new oracle states the
adapter-over-seed law independently of the queued projection: for each key it
recomputes the last applied adapter decision, or uses the latest hydration seed
when no adapter decision exists. It compares retained source rows, complete
public rows, and a change-message mirror after every completed action, plus
mirror/public agreement in every delivered callback.

On the starting production, four of thirteen bounded cases failed: hydration
after applied delete or truncate, both with and without an earlier chunk.
The delete witness retained an unwanted `after-target` row; the truncate
witness restored all three stale rows. The corrected implementation retains
adapter delete authority per key and global truncate authority for DbClient
Collections. The final fifteen history cells plus one reachability check pass.
The extra cells cover delete/reinsert, insert/delete, and truncate/reinsert.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. The existing late-hydration adapter-authority contract forbids seeds from superseding adapter work. The executable opening limits the claim to one or two immediately applied transactions, three keys, and up to two chunks. Queued work remains with the state-retention owner. |
| ORC-002: independent judgment | Pass. The reference scans a declared action history per key; it does not import or copy Collection's queued projection, authority lookup, or row classifier. |
| ORC-003: distinguishable responsibilities | Pass. The opening states the law and limits; the per-key scan is the model; the bounded cases are the grammar; DbClient hydration and sync actions are the driver; retained, public, and mirrored rows are the refinement check. |
| ORC-004: grammar controls | Pass for the bounded enumeration. The original applied-delete witness is reconstructed. Removing after-receipt hydration loses all four RED cases; removing truncate loses global-absence coverage; removing the untouched peer loses the selective-admission control. The domain crosses four one-transaction decisions with three hydration positions, plus three two-transaction histories. A different duplicate insert behind an authoritative insert is excluded by the existing duplicate-key contract. |
| ORC-005: production path and observation | Pass. The driver calls `DbClient.collection` with initial data, real sync `begin`/`write`/`truncate`/`commit`, and `applyCollectionChunk`. It checks after applied receipts and hydration calls, and captures callback-time mirror/public rows. |
| ORC-006: checker calibration | Pass. The unchanged production failed at the intended retained-row comparison in four cells, including the named delete and truncate mistakes. None failed during setup or cleanup. The corrected implementation passes all cells. |
| ORC-007: fixed/random campaigns and replay | Not triggered. This is a finite bounded enumeration, not an important generated property. |
| ORC-008: stateful-model minimality | Not triggered. The reference recomputes each expected row from the immutable declared history rather than maintaining a transition model. |
| ORC-009: vocabulary mapping | Pass. A model adapter decision maps to one sync transaction after its applied receipt; hydration seed, source row, public row, and change message retain their glossary meanings. |
| ORC-010: failure fidelity and cleanup | Pass. The driver retains the primary comparison failure, records separate unsubscribe and client-cleanup failures, and releases both resources. |
| ORC-011: independent second formulation | Not triggered. No plausible fault shared by the declarative last-authority scan and production's incremental admission was identified. The source/public/mirror comparison supplies complementary observations, not a second semantic formulation. |

Under ORC-012's class-closure condition, the bounded **applied** authority
class above is closed; the broader hydration authority class is not claimed
closed. The coverage map names the queued and applied owners and their limits.
Arbitrary stream orders, a later authoritative hydration epoch, and unbounded
retention remain outside this oracle's claim. With no hydration-completion
boundary, DbClient retains one tombstone per distinct adapter-deleted key until
Collection cleanup; non-DbClient Collections do not allocate that set.

The complete DB oracle campaign passed 42 files and 2,563 tests. The four
focused owners passed 493 tests. Package build, TypeScript, changed-file
ESLint and Prettier, and `git diff --check` passed.

## Follow-up review: queued partial-update dependency

- Reviewed implementation and test head:
  `0d580682cce96e829cb0152d9f8403d94904d81d`.
- Starting head: `9f719cfcac6fb53c7b2ac9952fa8999e302f0e2a`.
- Primary executable owner:
  `packages/db/tests/collection-state-retention-oracle.property.test.ts`.

A partial update admitted while a queued source row exists depends on that row.
If cancellation removes its only earlier source, the update's whole sync
transaction rejects with `AbortError`; downstream transactions that depended
on its writes reject as well. An update admitted against an absent key remains
an independent upsert, and a full-row update can replace an absent row. This
preserves the persisted-source partial-upsert contract rather than changing all
missing-key updates into errors. A surviving identical insert echo can become
the source row after an earlier insert is canceled, so its later update remains
valid.

The fixed witness was RED on the starting head: canceling the queued insert
left both committed and open dependent updates fulfilled and materialized a
row. The corrected head passes those witnesses, a same-transaction insert and
update control, independent-upsert controls, a surviving-echo control, and an
atomic multi-key/transitive-cancellation control. The generated driver crosses
three source origins, two update modes, cancellation, open versus committed
child receipts, and bounded row values. All 24 structural combinations have a
fixed witness; matching 100-run fixed-seed and seedless campaigns vary values.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. The user-approved dependency rule governs cancellation; existing persisted-source tests establish that absent partial updates may upsert. The claim covers direct Collection sync transactions parked before application, not arbitrary provider or persistence-wrapper scheduling. |
| ORC-002: independent judgment | Pass. The expected row and receipt outcomes are derived from the declared retained/queued source history and update mode. The reference does not read the pending projection, operation flags, or production classifier. |
| ORC-003: distinguishable responsibilities | Pass. The queued-update opening states the law and limits; the scenario's source history determines the expected row and receipt outcomes; its axes are the grammar; real sync actions plus a held mutation are the driver; applied receipts, retained rows, public rows, and the callback mirror are compared after the drain. |
| ORC-004: grammar controls | Pass. `queued-insert -> update -> cancel` reconstructs the reported case; queued upsert, retained row, and surviving echo distinguish source ownership. Removing the source-origin or cancellation axis loses the dependency witness; removing update mode loses the full-row independence control; removing receipt phase loses the open-transaction cut. The bounded domain is one key, two transactions, values -2 through 2, plus focused same-transaction and transitive/multi-key cases. Conflicting inserts and arbitrary nested `begin` calls are excluded. |
| ORC-005: production path and observation | Pass. The driver calls real `begin`, `write`, `commit`, and abort signals. It observes receipt outcome, retained and public complete rows after application, and mirror/public agreement at every delivered callback. |
| ORC-006: checker calibration | Pass. Temporarily removing the dependency revalidation check made the fixed-seed property fail by assertion after six tests. It shrank to queued insert, committed partial update, then cancellation with seed `190201` and path `5:0:1:1:1`. The mutant was restored; this was neither timeout nor setup failure. The original focused witness also failed at receipt and row comparison before the fix. |
| ORC-007: fixed/random campaigns and replay | Pass. Both campaigns use the same arbitrary, driver, observations, and 100-run budget. The fixed seed is `190201`; the other is seedless unless replayed. Direct guarded replay of seed `190201` and path `5:0:1:1:1` recorded the named property, the same path, two completed replay runs, and `failed:false` on the corrected head. |
| ORC-008: stateful-model minimality | Not triggered. The expected result is recomputed from each immutable scenario rather than maintained in a stateful reference model. |
| ORC-009: vocabulary mapping | Pass. The scenario's `source` arm identifies the retained source row, a queued adapter insert, or an independent queued upsert. `updatePhase` maps to an open or committed sync transaction; the applied receipt and public row retain their glossary meanings. |
| ORC-010: failure fidelity and cleanup | Pass. The queued harness preserves the primary mismatch separately from cleanup failures, releases the held mutation, and cleans up the subscription and Collection. Fast-check retains the failing input, seed, and shrink path. |
| ORC-011: independent second formulation | Not triggered. The reviewer did not name a fault plausibly shared by the source-history reference and production's queued projection. Existing persisted-source upsert tests and the full-row/independent-upsert controls reject the initial overbroad design. |

Under ORC-012, the bounded direct-sync dependency class above has no known
reachable counterexample. The original cancellation witness and adjacent
upsert, full-row, echo, open-transaction, and transitive witnesses are owned by
the state-retention oracle. Persistence-wrapper replay remains owned by the
SQLite persisted histories, and Electric stream completeness remains owned by
the Electric oracle; neither is claimed closed by this Collection test. The
coverage map names these owners and their limits. This append-only record names
the exact reviewed implementation head; it is committed afterward.

The complete DB oracle campaign passed 42 files and 2,575 tests; the focused
owner passed all 80 tests. The full DB runtime suite passed 186 files and
6,543 tests with Vitest's background typecheck disabled. Electric runtime
oracles passed 211 tests and persisted-source tests passed 437 tests. The DB
package build, direct `tsc --noEmit`, changed-file ESLint and Prettier, and
`git diff --check` passed. An earlier full Vitest run with background typecheck
enabled passed its runtime assertions but exited nonzero: two new test
type-narrowing errors were then corrected, while separate diagnostics in the
untouched subset-error test file remain outside this change.
