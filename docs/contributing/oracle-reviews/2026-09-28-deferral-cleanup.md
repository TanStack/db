# Publication deferral cleanup review

## Reviewed state and law

- Base commit: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Reviewed implementation and oracle head:
  `8a6a024e` (the review record follows that immutable commit).
- Owner: `packages/db/tests/collection-subscription-lifecycle-publication.property.test.ts`
  with its deferral histories in `collection-subscription-lifecycle-grammar.ts`.

Collection cleanup ends a sync run. A publication deferral from that run cannot
discard or publish a later run's subscriber batch. The new run publishes its
committed changes when its own deferral closes with `publish()`. Its own
`discard()` suppresses those changes. The driver compares the exact subscriber
batch after each handle closes and checks for early delivery after an old
handle closes.

The bounded grammar has two sync runs and one or two new rows. It crosses an
inner handle's `publish()` or `discard()`, four old outer-handle close modes,
and the new handle's `publish()` or `discard()`. One close mode leaves the old
handle open. Another closes it before the new deferral. The last two close it
with `publish()` or `discard()` while the new deferral is active. The grammar
contains 32 unique histories.

## RED, repair, and GREEN

On the base commit, the first controlled witness reached the new subscriber
callback checkpoint. It expected `[["c"]]` and observed `[]`. The first 16-case
grammar produced four assertion failures. Each failure required an inner
discard before cleanup and a new publication after restart.

A one-line reset of the old discard flag made those 16 cases pass. An
independent prep review then found a second legal history. The old outer
handle could close the new run's active deferral. With an old `publish()`, the
subscriber received the new batch before the new handle closed. With an old
`discard()`, the subscriber missed the new batch. The expanded 32-case grammar
rejected that reset-only repair in 12 cases. These were assertion failures at
the intended old-handle or new-handle checkpoint. They were not setup failures
or timeouts.

The repair gives each deferral its own record. Each handle captures that record.
Cleanup retires the record. A handle from the retired run cannot close the new
record. The 32 histories and the adjacent sync reentrancy suite passed, 160
tests total. The DB oracle campaign passed 42 files and 2,669 tests with no
Vitest type errors. Changed-file ESLint, Prettier, and `git diff --check`
passed. Direct package `tsc --noEmit` still reports two unresolved
`@tanstack/db` self-imports in conformance files in this unbuilt checkout. It
reports no error in the changed files.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. Collection cleanup and publication contracts require a restarted run to publish independently. The executable opening and coverage map state the finite history limit. |
| ORC-002 independent judgment | Pass. The reference selects post-restart writes and the new handle's close action. It does not read production depth, discard flags, revision fields, or event queues. |
| ORC-003 distinct responsibilities | Pass. The opening states the law. The shared grammar defines histories and the reference. The driver calls the real Collection sync, cleanup, restart, deferral, and subscription APIs. Subscriber batches at close are the refinement check. |
| ORC-004 grammar controls | Pass for bounded enumeration. The grammar reconstructs the reported sticky-discard history and the adjacent stale-handle overlap. Without inner discard, the original fault is absent. Without overlap, the second fault is absent. One and two rows distinguish loss from batch grouping. A new discard is a negative control. The range is two runs, one old row, and one or two new rows. Construction excludes a new-handle close before its open and restart before cleanup. |
| ORC-005 path and observation | Pass. The driver records two actual sync invocations and uses a real `subscribeChanges` callback. It checks no early batch during writes or an old-handle close, then checks the exact batch when the new handle closes. |
| ORC-006 checker calibration | Pass. The base failed four of 16 cells. The reset-only wrong design failed 12 of 32 cells. Both reached the intended subscriber comparison with an assertion failure. |
| ORC-007 campaigns and replay | Not applicable to this bounded enumeration. The owner's existing fixed-seed and seedless generated properties remain in the 42-file campaign. |
| ORC-008 model minimality | Pass. Post-restart row keys and the new close action determine this law's expected batch. An old-run close cannot change it. A different new row or close action changes the promised observation. |
| ORC-009 vocabulary | Pass. `cleanup` ends a sync run. `restart` begins a new sync run. Each `write` is one immediate sync transaction. A callback batch is the public publication observation. The grammar's handle labels identify deferrals, not acquisitions. |
| ORC-010 failure fidelity | Pass. The driver keeps the primary mismatch, attempts unsubscribe and cleanup separately, and places any cleanup errors after the primary error in an `AggregateError` with its cause. |
| ORC-011 second formulation | Not triggered. The identified wrong designs are rejected by the reference and real callback trace. A second semantic formulation has no named shared-fault hypothesis here. |

This versioned record supplies ORC-012 evidence for the reviewed head.

## Coverage boundary and review loss audit

The Collection lifecycle publication owner covers the direct Collection path
for the 32 histories. The includes publication owner still needs a compiled
includes witness: cleanup during a discarded source deferral, then a parent or
child publication observed at its callback boundary. The coverage map names
that owner and witness. This direct-path result does not establish all includes
graph schedules or arbitrary numbers of nested handles.

The source audit's three recorded claims and the prep review's adjacent
finding are accounted for. The sticky-discard and stale-handle product bugs
are fixed now. The missing lifecycle transition is covered by the bounded
grammar. The proposed one-record shape was useful but needed an identity check
to isolate old handles. No finding is refuted or silently deferred. The
compiled includes witness is an explicit remaining coverage item.

## Follow-up review: subscriber change payloads

- Reviewed executable head: `126ee08789d1146dcb1db3b173c66a39e8933701`.
- The review record follows that immutable commit. This follow-up changes the
  oracle only; the Collection implementation and 32-history grammar are the
  same as in the first review.

The [Collection API](../../reference/interfaces/Collection.md) says that
`_deferPublication()` delays subscriber events until a coherent commit ends,
`cleanup()` clears the Collection and permits a later sync run, and
`subscribeChanges()` delivers change messages. The [glossary](../glossary.md)
defines cleanup as the end of a sync run. This PR makes one explicit design
decision at their boundary: a deferral handle belongs to the sync run in which
it opened. Cleanup retires that handle's authority over later publications.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001 authority and limits | Pass with the API, glossary, and design decision above. The direct Collection path and finite-history limits remain as stated above. |
| ORC-002 independent judgment | Pass. The reference still selects only post-restart fixture writes and the current handle's close action. It now describes each expected insert's key and row value. |
| ORC-003 distinct responsibilities | Pass. The existing opening, shared grammar, real Collection driver, and subscriber comparison remain visible. |
| ORC-004 grammar controls | Pass. The same 32 histories, ablations, range, and exclusions apply. |
| ORC-005 path and observation | Pass. The callback recorder now preserves each change's type, key, row value, and prior value. It keeps callback boundaries and excludes virtual fields from this bounded comparison. |
| ORC-006 checker calibration | Pass. A temporary mutant changed deferred callback row values to `-1`. Before this follow-up, all 32 histories survived. With the stronger recorder, 16 histories failed at the new-handle subscriber assertion. The original base and reset-only controls remain rejected. |
| ORC-007 campaigns and replay | Not applicable to the bounded enumeration, as above. |
| ORC-008 model minimality | Pass. The reference remains a stateless projection of fixture writes and the current close action. |
| ORC-009 vocabulary | Pass. The command-to-production mapping above remains unchanged. |
| ORC-010 failure fidelity | Pass. The driver still preserves the primary assertion and secondary cleanup errors separately. |
| ORC-011 second formulation | Not triggered. No new shared-fault hypothesis arose from the payload observation. |

The focused publication and lifecycle suites passed 334 tests with no Vitest
type errors. Changed-file ESLint, Prettier, and `git diff --check` passed. The
compiled includes witness remains open with the same coverage-map owner.

## Follow-up review: retired queue ownership and null prior values

- Reviewed executable head: `cda3e71fbf900d1bcdab0bd28be027fca8c605ac`.
- This record follows that immutable commit. The production change releases
  queued messages from deferrals retired by cleanup or their final close.

A later CodeRabbit review of `9b069242` identified a retained queue. A stale
handle remains reachable after cleanup and captures the old deferral record.
Cleanup removed the manager's reference, but left its queued publications in
the captured record. `changes.ts` was byte-identical at the later `4e615774`
head, so the same finding applied there. A focused test queued one publication,
held the old handle, and checked the retired record after cleanup. Before the
repair it failed with one retained publication at the queue-cardinality
assertion. The adjacent final-close case retained the queue as well. The repair
empties each retired queue while preserving the messages needed for a normal
`publish()`. Both cases pass, and stale handles still cannot affect a new run.

Queue retention has no public subscriber observation: a subscriber sees the
same messages whether a retired, reachable handle retains an array or releases
it. The focused internal invariant test is the appropriate witness for this
memory-ownership law. The 32 public publication histories remain the oracle
for delivery and isolation. The direct Collection path still does not prove
the compiled includes witness named above.

A separate checker control exposed a null-value observation gap. A temporary
subject mutant injected `previousValue: null` at the final subscriber callback.
The first payload recorder treated that prior value as absent, and all 32
histories stayed green. The corrected recorder preserves `null` and omits only
`undefined`; the mutant then failed 16 of 32 histories at the subscriber
equality assertion. Unmutated production passed all 32. This control changes
the oracle's observation fidelity, not the product contract or history grammar.

The focused publication, sync reentrancy, and lifecycle suites passed 361 of
361 tests with no Vitest type errors. Changed-file ESLint, Prettier, and
`git diff --check` passed. Against `origin/main`, production `changes.ts` is
36 lines added and 30 removed, a net increase of six lines. Tests and review
documentation are accounted for separately.
