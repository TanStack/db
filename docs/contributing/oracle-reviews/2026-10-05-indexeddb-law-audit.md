# IndexedDB law enforcement follow-up

> Historical audit: the [October 6 refinement audit](2026-10-06-indexeddb-tla-refinement.md) records the subsequent design decision, completed repair and executable evidence. The open dispositions below describe the earlier snapshot.

This audit starts at PR #1179 head
`34eb98b16d6174d1722878de3cb3b2cd5dc4dabe`. It revisits all 15 findings from
`2026-10-05-indexeddb-xhigh.md` under the stronger evaluate-review standard:
identify the reusable law, inspect its model and reach, and prove its assertions
reject plausible wrong implementations. Changes described here are in the
working tree; they are not yet committed or pushed. The deletion law remains
**open**, with a concrete failing history and a design decision requested.

## Result

The previous evaluation overstated closure. Four wrong implementations passed
its relevant green suites. The strengthened oracles reject them:

| Wrong implementation | Previous evidence | Strengthened evidence |
| --- | --- | --- |
| Match Collection IDs instead of Collection references | 21 compatibility/persistence tests passed | Four same-ID owner-projection assertions fail; distinct-ID controls pass |
| Ignore a current durable row without a version record | 38 transport tests passed | Four current-row comparisons fail; versioned controls pass; the native witness fails in Chromium, Firefox and WebKit |
| Read storage for malformed envelopes, then ignore them | 38 transport tests passed | The zero-storage-work assertion fails; valid neighboring invalidation still reads |
| Replace a native cause with an equal-looking DOMException | 20 wrapper tests passed | Exact request-cause identity assertion fails |

These were missing distinctions, not missing random runs. Production already
satisfies the strengthened four laws. No production workaround was added for
these tests.

The audit also found a reachable counterexample to the repaired deletion design.
A connection that observed native deletion is insufficient evidence that a
received success notification belongs to that deletion. XH-07 is reopened.

## Laws and enforcement, in original finding order

Paths below refer to `packages/indexeddb-db-collection/tests` unless qualified.
The original findings remain separate even when they share a law.

| ID | Law or obligation | Model, histories, production path and enforced observation | Disposition |
| --- | --- | --- | --- |
| XH-01 | Successful automatic writes in one Collection persist in author order; rejected handlers or failed native batches contribute no durable effect and release successors. Authority: approved ordering policy and native atomicity. | `local-write-order-oracle.test.ts` folds authored whole-row effects over the independently authored peer base. 576 histories cross three same/disjoint/reinsert effects, all six handler orders, eight decision masks and four ordered peer prefixes. At every decision it checks the decided author prefix in raw storage, the peer and fresh restore, plus absence of premature caller success. Four more cases cover held predecessors, handler reentry and queued successors after native failure. A completion-order mutant causes 287 assertion failures. Intermediate local optimistic publications are a separate law below. | fixed-now within these stated receiving boundaries |
| XH-02 | Mutation ownership is Collection-reference identity, independent of user IDs and cleanup of its sync run. | Compatibility checks renamed IDs and adds equal/distinct IDs, both acceptance orders, live/cleaned-up sync runs and mixed manual payloads. Every acceptance checks both stores, version ownership and restore. Keys are disjoint so core same-ID/same-key mutation merging cannot replace the tested adapter boundary. The ID-equality mutant changes both stores and fails. | fixed-now |
| XH-03 | Optional row version metadata cannot define source membership. A notification reads current durable whole-row values; duplicates cannot introduce duplicate rows or restore omitted fields. | Transport crosses initial membership, key type and metadata present/absent at the receiving read, independently of existing startup-metadata cases. Raw writes occur before delayed real peer notifications; duplicate delivery and a later versioned suffix check cache continuity. A native two-page receiving witness uses real writes, reads and duplicate BroadcastChannel messages. Low-level writers explicitly send invalidation; wrapper writes do not automatically broadcast. The missing-version mutant fails four controlled comparisons and all three engines. | fixed-now for delivered invalidations |
| XH-04 | Import accepts schema input, validates/transforms once, uses transformed keys, and rejects the entire replacement before storage if any input or key is invalid. Export returns durable schema output. | The Date example retains the input/output distinction. Settlement now crosses schema errors and transformed-key collisions with all three positions in a batch; it compares unchanged public/raw/peer rows, exact prior versions and zero storage work. An accepted suffix must produce independently authored numeric keys and uppercase values, including fresh restore. Source and published-consumer types distinguish input from output. A universal inverse transform is not promised. | fixed-now; separate trusted-output restore remains an unrequested API design |
| XH-05 | Both the requested store and the metadata store must exist before options are accepted. | Synchronous configuration examples cover missing data/metadata stores and healthy creation. The native pre-existing same-version schema reaches the missing-metadata premise. Original-source calibration failed the intended admission assertion. This finite configuration predicate needs no history state machine. | fixed-now |
| XH-06 | Managed connections close on versionchange; existing native transactions may finish, later work through the retired connection fails, and the app recreates affected Collections. | Transport checks exact native recipients, pending unmanaged blockers, preserved upgrade rows, failed old-descriptor writes, downstream error after an old read, and fresh restore/write. Native tests receive versionchange while native work is held. The policy is explicitly approved and documented; no new automatic restart or in-memory fallback is inferred. | accepted-design, not deferred implementation |
| XH-07 | Successful deletion may empty only Collections belonging to the deleted database lifetime, and only after that deletion completes. A different lifetime's notification cannot supply completion. | The existing connection-scoped model distinguishes old and recreated connections only until the recreated connection sees another deletion. The new controlled/native histories retain an old successful receipt, recreate and populate the database, start another deletion behind an unmanaged blocker, then deliver the old receipt. Durable rows remain; the recreated peer incorrectly becomes empty. The comparison reaches the intended publication cut. | design-decision; confirmed behavioral defect remains open |
| XH-08 | Invalid protocol envelopes carry no authority to access storage or publish changes; valid neighboring messages remain effective. | The existing malformed-value matrix now counts native transaction admission before any row observation can hide unnecessary work. It requires zero transactions for malformed inputs and one for a valid unseen-row invalidation. The eager-read mutant previously passed and now fails. Self/database/store routing has separate positive witnesses. | fixed-now |
| XH-09 | Contextual wrapper errors retain the original native cause object; callback rejection keeps its identity. | Wrapper checks native request/open failures and separate open/delete/store/transaction admission branches. Assertions now use identity rather than structural equality for native causes. A cloned DOMException survives the previous suite but fails the strengthened request comparison. Existing callback/native-completion matrices retain exact callback failure outcomes. | fixed-now |
| XH-10 | Exported error APIs must describe actual behavior; the approved API uses native causes instead of unused constructors. | The five unused constructors and reference pages were removed in the prior repair. Source/export inventory and declaration checks are the appropriate evidence; no product state machine is implied by removal of unused symbols. | fixed-now |
| XH-11 | Runtime/type oracle results depend on workspace source, not pre-existing distribution files. | Dedicated runtime/type source configuration and coverage-disabled oracle scripts remain unchanged. The prior full suite ran with all three dist directories absent; current source runtime and type checks pass. Declaration-consuming tests are explicitly separate. This is a test-integrity contract, not a row model. | fixed-now |
| XH-12 | Default runtime tests must not rebuild shared dependencies; published consumers must still receive completed builds. | Default scripts have no builds, root package checks follow runtime suites, and CI reuses completed builds after its runtime group. The published consumer lane builds ESM/CJS and compiles five module-resolution configurations without skipLibCheck. Duplicate builds were verified; an actual historical CI race was not claimed. | fixed-now |
| XH-13 | A native batch admits its data/version requests before awaiting their success, but only native transaction completion can establish atomic success. | Settlement counters now cover automatic insert/update/delete and import, with empty import and one/ten-row batches. Counts are exactly 2N before the first successful request. A serial-delete mutant fails both delete cases. Existing first/middle/last clone-failure and abort matrices retain value atomicity. No elapsed-speedup claim follows. | fixed-now |
| XH-14 | Wall-clock metadata has no row/version-order authority; removing it must preserve legacy reads and unrelated records. Utility types retain schema input/output and Collection key types without an unused parameter. | Persistence crosses absent/past/future legacy timestamps, update, untouched anchors, mixed-format restore and replacement. New records have only a version token. Three format assertions failed before removing updatedAt; the two-parameter utils type failed before removing the phantom key parameter. Updated source and published consumers pass. | fixed-now in this working tree |
| XH-15 | estimatedSize, when available, is the origin's approximate usage, not this database's size. | The empty-database controlled estimate and corrected property/guide/README scope remain intact. This diagnostic forwarding contract does not require a stateful oracle or invent a database-size estimate. | fixed-now |

## The deletion counterexample and decision

A database lifetime starts when the named native database is created and ends
when it is deleted. A connection can end earlier, for example during an upgrade.
Those are distinct identities. The new model cannot collapse a retired connection
from the first lifetime with a connection observing deletion in a second lifetime:
the same incoming old notification must have different authority.

1. Native deletion of lifetime A completes; its success callback is held.
2. Another context creates lifetime B and persists a row.
3. Deletion of B begins. Its peers observe versionchange and close, but an
   unmanaged connection keeps native deletion incomplete.
4. A's held callback broadcasts its old success notification.
5. B's peer becomes empty although B's durable row still exists and B's deletion
   is still pending.

The controlled oracle fails at `old receipt cannot complete newer deletion`.
The native oracle checks real versionchange, a live unmanaged connection, retained
durable rows and pending native completion before judging the peer snapshot.
A first Firefox fixture waited for a blocked event that did not arrive at that
cut. That timeout is not credited as a product failure; blocked-event timing is
not the authority being tested. The corrected native witness fails at the
intended peer-snapshot assertion in Chromium, Firefox and WebKit; all three
retain the durable row while the newer deletion is pending.

The recommended correction is a persisted identity for each database lifetime,
carried by deletion notifications and retained by each descriptor. Native
connection retirement would remain a necessary condition. An old lifetime's
success could not authorize clearing a newer lifetime, even after that newer
connection sees another deletion. This changes the previously approved design
and stored metadata. The maintainer requested research before deciding. An
alternative is to stop clearing peer snapshots on deletion and require explicit
recreation; that changes the existing publication contract. No deferral is claimed.

The research found stored dataset identity in RxDB and PouchDB, and separate
connection retirement/deletion APIs in Dexie and idb. It also identified a limit
on the proposed correction: a native delete is queued by database name, so a
captured descriptor identity does not prove which lifetime the request removes.
A native-only delete/recreate/delete probe reproduced removal of the recreated
dataset at the same version in Chromium, Firefox and WebKit, with both delete
requests admitted while the original connection still existed. This is platform
research, not a newly claimed adapter RED. A concrete design must distinguish
notification authority from native request targeting; merely adding an identity
field does not prove both. No deletion implementation has changed. The research
record and native traces remain in task review evidence.

## Validation and limits

Before adding the newly discovered deletion counterexample, the complete suite
passed **783 runtime/type tests**, **12 published-consumer tests**, and **57
browser cases**. These numbers are not a current all-green claim: the deletion
counterexample now makes the relevant suite red. The latest complete
runtime/type run has **783 passing tests and one failing deletion assertion**,
with no type errors. The corrected native deletion witness has **three
assertion failures**, one in each engine. TypeScript, lint and whitespace
checks pass for the work through that point. The local build still uses cached
Rollup 4.59.0 because tracked 4.64.0 is unavailable from the configured registry;
the lockfile is unchanged.

The four formerly surviving mutants now fail assertions. The additional
completion-order mutant fails 287 assertions, and serial delete admission fails
two. These are counted separately from the original review's earlier RED evidence.
The new cases are bounded enumeration, not claims of generated grammar coverage;
existing fixed/fresh campaigns and replay interfaces are unchanged.

The local-order owner observes intermediate durable/peer/restore prefixes and
final local rows. It does not replace the core optimistic-publication model.
The pending companion still receives only one local intent's intermediate
publications. Multi-intent intermediate local publications, peer work between
local acceptances, pending mutation outcome across cleanup/restart, unordered
same-key cross-Collection writes, lost notifications, and physical crash durability
retain their named coverage-map boundaries. None is proved by adjacent green
checks. The deletion counterexample is inside the claimed deletion boundary and
therefore prevents closure of XH-07.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Approved author ordering, Collection-reference ownership, atomic native completion, schema-input and deletion-publication laws are stated; the new deletion design is not silently adopted. |
| ORC-002 | Authored effects/store projections determine expected rows; native reads and native error objects are independent observations. No production cache computes truth. |
| ORC-003 | Prose beside each extended owner explains law, model, finite histories, production path and cut. |
| ORC-004 | No new generated property; new matrices are explicitly bounded. Existing generated owners and their controls are unchanged. |
| ORC-005 | Actual Collection operations, native request admission, raw storage, caller outcomes, peer snapshots and fresh restores reach the asserted cuts. |
| ORC-006 | Four previous survivors now fail comparisons; completion-order and serial-delete mutants fail their intended cuts. The new deletion counterexample fails on current production. |
| ORC-007 | New matrices are finite enumeration. Existing fixed/fresh/replay campaigns remain active; no random-run claim substitutes for the matrices. |
| ORC-008 | Decided author prefixes and Collection references retain distinctions exposed by later actions. The deletion counterexample proves connection retirement loses a database-lifetime distinction. |
| ORC-009 | Collection, sync run, settlement and publication remain distinct. Database lifetime versus connection lifetime is defined above. |
| ORC-010 | Held local decisions release in finally; native/controlled deletion blockers release before comparing captured evidence. Primary failures survive cleanup. |
| ORC-011 | Raw storage and fresh restore challenge optimistic-only agreement; exact native cause identity distinguishes structurally equal replacements. |
| ORC-012 | All 15 original findings and their law evidence are accounted for. This working-tree record explicitly reports the open defect and does not claim closure. |
| ORC-013 | Equal/distinct IDs, absent/present metadata, invalid/valid messages, pending/completed prefixes, and old/new deletion lifetimes distinguish reusable boundaries. |
| ORC-014 | Missing metadata receives a native witness in all three browsers. The corrected two-deletion receiving witness fails its intended snapshot assertion in all three engines; the initial Firefox setup timeout is not credited as a kill. |

## Loss audit

The disposition accounting is **13 fixed-now + 1 accepted-design + 1
design-decision = 15**. XH-07 is confirmed and unresolved. There are no deferred
items. This accounting does not mean the implementation work is finished.

## Subsequent TLA+ refinement

The [TLA+ translation and loss audit](2026-10-06-indexeddb-tla-refinement.md)
supersedes the open deletion-design disposition above. It records the approved
administrative deletion contract, oracle-first RED, source repairs, loss recovery,
production fault calibration and native receiving evidence. The historical
counterexamples above are retained; no deferral is used to claim closure.
