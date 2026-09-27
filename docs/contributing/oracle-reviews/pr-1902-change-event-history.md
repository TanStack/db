# PR #1902 change-event and queued-admission oracle review

## Reviewed state

- Base commit: `f473a36201abe9af43d36a83492a2649668756d8`.
- Original PR head: `8c763b8c531297ec615e157c3669a907a4b6eb59`.
- Reviewed change: the Git tree containing this record, PR #1902, and the
  queued-admission follow-up produced by its external-review evaluation.
- Primary executable owners:
  `packages/db/tests/change-event-history-oracle.test.ts` and
  `packages/db/tests/collection-state-retention-oracle.property.test.ts`.

The eventual commit or pull request identifies the exact immutable tree. This
record fixes the comparison base because a file cannot contain the hash of the
commit that already contains it.

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

ORC-012 is satisfied by this versioned, base-identified record and its link from
`docs/contributing/oracle-coverage.md`.

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

## Verification boundary

Closeout requires the two executable owners, the existing load-subset
cancellation owner, the package type check, changed-file lint/format checks,
and `git diff --check`. Exact final counts belong in the pull request or task
receipt because they describe that immutable execution rather than this law.
