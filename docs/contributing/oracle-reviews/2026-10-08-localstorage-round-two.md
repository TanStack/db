# LocalStorage second oracle review, 2026-10-08

The four independent reviews examined PR #2074 at
`9344612bed911a364af6c9c3f9b023487cf6979a`. The normal merge of
`origin/main` produced `d5205b792e34f0f6f0282b7811a5c7de712ae0cd`;
all changed oracle histories were first run against that merged implementation.
The repaired implementation reviewed here is
`1f103c8504d135c1fa35215efba9d7ebc5db92e2` (the versioned record itself is a subsequent documentation-only
commit).
The append-only raw intake is `/private/tmp/pr2074-round2-review-ledger.md`.

## Reviewer assessment and loss audit

These reviews were accurate and useful. Three reviewers independently found
the same parser-normalization gap, which raises confidence but counts as one
product cause. The queue reviewer separated accepted local work from a later
API failure rather than incorrectly demanding cancellation. The key findings
also distinguished a serializable NaN-derived key from a nonfinite value that
JSON cannot round-trip. Proposed fixes were mostly narrow; canonical-key
rejection was stronger than the existing legacy compatibility contract.
Technical depth and signal-to-noise were high. **Hire recommendation: yes.**

| ID | Technical verdict and evidence | PR action | Durable value |
| --- | --- | --- | --- |
| R2-RC1 | Confirmed: unchanged-token normalization of an untouched row left writer and peer stale at the fulfilled receipt. | Fixed in peer oracle and content comparison. | Paired changed/unchanged token histories. |
| R2-PE1 | Same confirmed cause, independently probed. | Duplicate of R2-RC1. | Retain independent receipt evidence. |
| R2-PA1 | Confirmed: postwrite custom-parser read fault rejected a durable write. | Fixed by validating serialized custom-parser bytes before `setItem`. | Prewrite and postwrite fault-position histories. |
| R2-Q1 | Confirmed: `mutationFn` failure settled before its previously accepted queued write. The later write itself is allowed by the mutations guide. | Fixed in transaction settlement and order oracle. | Held and released receipt cuts with durable, public and restore observations. |
| R2-PA2 | Confirmed: `n:1` and `n:01` silently collapsed into one Map identity. | Fixed by rejecting duplicate decoded identities before readiness. | Malformed snapshot grammar retains legacy single-key support. |
| R2-PE2 | Confirmed: a serializable row deriving numeric NaN as its Collection key wrote successfully but could not restore. | Fixed with SameValueZero identity validation. | NaN, finite number, and string controls. |
| R2-PE3 | Confirmed wording gap: guide implied legacy unprefixed keys were invalid. | Fixed guide wording. | Explicit compatibility boundary. |
| R2-RC2 | Confirmed review evidence gap for the previous changed head. | Fixed with this versioned exact-implementation review. | ORC-012 outcomes below. |
| R2-PA3 | Same confirmed normalization cause, independently probed. | Duplicate of R2-RC1. | Retain the parser-focused probe. |
| R2-Q2 | Confirmed: default JSON changed nonfinite numeric row IDs to null after a fulfilled receipt. | Fixed by checking the restored key before writing. | NaN and both infinity cases. |
| R2-Q3 | Confirmed oracle fixture admitted manual work outside `mutationFn`; a legal direct nested insertion reached the same peer reentry and passed. | Fixed the driver; no product change for this item. | Protect legal callback reentry. |
| R2-Q4 | Same ORC-012 gap as R2-RC2. | Duplicate of R2-RC2. | Retain independent evidence audit. |

All twelve raw items are accounted for: nine fixed and three duplicates.
No item is deferred or awaiting a design decision. The separate negative
controls remain accepted: fire-and-forget nested automatic work after an outer
failure is independently admitted; awaiting a later same-Collection write in
an earlier handler is an order dependency cycle; simultaneous cross-tab writes
and distinct custom Storage wrapper objects have no atomic coordination law.

## Law coverage and calibration

**Durable/public agreement (R2-RC1, PE1, PA3, PA1).** The LocalStorage guide
promises active same-tab peers agree with a successful stored snapshot at the
fulfilled persistence receipt, apart from the stated default-JSON native-value
writer exception and failed reads. The independent authored-row fold predicts
the normalized prior row and new row. The peer owner varies whether the parser
changes the prior token. The unchanged-token case failed at the writer/peer
receipt on `d5205b7`; the changed-token control passed. A separate one-shot
postwrite `getItem` fault failed the successful-receipt assertion while durable
bytes already held the row; the prewrite-fault control still rejects without
writing. The repaired code parses and validates custom-parser bytes before
the durable write, then uses that snapshot for confirmation and publication.
The finite law covers the named parser, one write, active same-object peers,
receipt and fresh restore. Arbitrary parser side effects and native browser
scheduling remain outside this fixture's claim.

**Key identity and restorable receipts (R2-PA2, PE2, Q2).** One stored entry
must represent one Collection key, and a fulfilled write must permit a fresh
restore of its row. The malformed classifier now rejects two encodings that
decode to one number before readiness. The typed-key driver accepts a
serializable string that derives NaN, plus finite number and string controls;
fresh restore failed on `d5205b7` and now passes. The default-JSON writer
driver tries NaN and both infinities as row IDs; on `d5205b7` each fulfilled
and wrote un-restorable data, while the oracle expected rejection and unchanged
storage. The repaired writer checks each changed row's JSON key round trip
before `setItem`. A single legacy unprefixed string key remains accepted;
duplicate identity is invalid regardless of spelling. The fixed finite inputs
do not prove every user-defined key extractor or serialization shape.

**Accepted-work settlement (R2-Q1).** The mutations guide permits local work
accepted before a later API error to persist. The transaction receipt cannot
settle until that registered work finishes. The order owner's independent fold
contains both accepted rows. Its driver holds an earlier automatic handler,
calls un-awaited manual acceptance inside `mutationFn`, then throws. At the
held cut, both commit and persistence receipt were incorrectly rejected on
`d5205b7`; now both remain pending. After release, both report the original
API error, while durable, public, and fresh-restore rows show the accepted
write. The nearby successful and storage-fault manual histories protect the
other settlement paths. This does not make multiple Storage keys atomic.

**Legal reentry (R2-Q3).** The peer owner now inserts directly from the
subscriber callback. This is an admitted production path, unlike calling
manual acceptance before commit. Its nested receipt and later update compare
writer, peer, and durable rows. The legal replacement passed before the
production repair, so this item was a driver correction rather than a product
RED case.

## Oracle guide audit

- **ORC-001:** The guide and oracle opening prose state receipt, key, and
  restoration laws and the cross-tab, parser, and native-value limits.
- **ORC-002:** Expected rows come from authored operations or a malformed
  snapshot classifier, never the adapter mirror, version cache, or decoder.
- **ORC-003:** Opening prose, model helpers, bounded histories, production
  calls, and receipt/restore assertions remain adjacent in both owners.
- **ORC-004:** The finite token-change, typed-key, fault-position, and held
  predecessor axes reconstruct the reported cases and controls. Removing the
  unchanged-token, NaN, postwrite, or failure-after-acceptance member loses
  its corresponding wrong design. Invalid malformed bytes are rejected. No
  unbounded generated-history claim is made.
- **ORC-005:** Real Collection insert, manual transaction, preload, same-tab
  publication, and fresh restore paths reach the named public observations.
- **ORC-006:** The merged pre-fix implementation failed the intended new
  assertions; the legal nested-reentry replacement passed as a negative
  control. Failures were assertions, not setup errors or timeouts.
- **ORC-007:** Not applicable: the changed tests are fixed finite histories,
  not an important random generated property.
- **ORC-008:** Not applicable: no state was added to or removed from the
  independent authored-row fold.
- **ORC-009:** The fold's accepted row maps to a completed Storage write;
  pending handler and receipt are production timing concepts observed by
  controlled gates, not hidden model state.
- **ORC-010:** `withHistoryCleanup` releases handlers and Collections after
  assertions while preserving the primary failure.
- **ORC-011:** Durable-byte inspection and fresh Collection restore are
  separate formulations of the receipt result. They differ from active peer
  publication; no additional shared-fault hypothesis remains for this scope.
- **ORC-012:** This record reports each applicable requirement and explicit
  non-applicability, with the law boundaries and original/adjacent witnesses.
- **ORC-013:** Changed and unchanged tokens, prewrite and postwrite faults,
  serializable versus lossy nonfinite keys, and held versus released work
  distinguish the reusable conditional laws from plausible wrong boundaries.
- **ORC-014:** The controlled `StorageApi` preserves native `getItem` and
  `setItem` return semantics. These findings are scoped to that API seam;
  cross-tab native scheduling is not inferred from the in-memory event host.

## Verification

The initial oracle-only run on `d5205b7` had eight intended failures among
92 focused tests: same-token normalization, duplicate decoded key, NaN
restore, three lossy nonfinite IDs, postwrite fault, and early failure
settlement. The neighboring changed-token and legal nested-reentry controls
passed. After repair, the two primary oracle files passed all 92 initial
tests. A final legacy-key control increased the peer owner to 49 passing
tests; the broader LocalStorage run had passed 150 tests before that added
control. The full package runtime suite passed 11,390 tests before that added
control. Standalone source and test TypeScript, package build, changed-file
lint, formatting, generated error docs, and ESM/CommonJS production error
checks passed. Vitest's integrated typecheck still exits nonzero on the
unchanged `src/collection/index.ts:961` overload diagnostic, while both
standalone TypeScript checks pass; it is not reported as a green integrated
gate. CI results on the pushed head are tracked separately.
