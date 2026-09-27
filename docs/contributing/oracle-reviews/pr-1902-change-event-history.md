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
