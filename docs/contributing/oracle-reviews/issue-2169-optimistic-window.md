# Optimistic ordered-window departure review (#2169, related #2148)

## Contract and repair location

The reported #2169 window kept `[3, 2]` while an optimistic membership-removing
update persisted. The issue's maintainer comment accepts an immediate short
window as the way to preserve optimistic visibility while a provider refill is
pending. #2148 shows a related joined/anti-joined path: the departure is
visible, but acquisition does not make useful refill progress. These are two
obligations, not one expected final row array.

The accepted law is in
`packages/db/src/query/live/ARCHITECTURE.md#atomic-window-publication`.
An optimistic overlay is not an authoritative loss of provider coverage.
Collections and Effects publish its membership departure synchronously. They
recompute over installed rows, even if that produces a short window. If the
provider has a useful missing row, bounded acquisition starts while the
mutation persists. A provider write queued behind that mutation remains
private until its sync transaction applies; publication can precede resolution
of the applied-receipt promise. Rollback removes this overlay and recomputes
from the current base and any remaining overlays. The prior window is restored
only in an otherwise isolated history.

The repair is in the ordered source loader. A visible delete or order change
normally invalidates the authoritative source prefix and starts a gated repair.
That classification was also applied to optimistic overlay departures. The
loader now consults the source Collection's active overlay for the changed key:
it still sends the change into the graph and asks for needed finite refill,
but does not claim authoritative source-order loss. Existing initial-load,
window-move, and authoritative-repair barriers remain in force.

## Executable evidence

The primary owner is
`packages/db/tests/query/ordered-work-oracle.property.test.ts`. Its controlled
provider has a separate six-row ledger. An independent reference recomputes
the public window from explicitly installed IDs and one overlay, then sorts
and slices it. Rows below the visible boundary distinguish bounded refill from
full-source overfetch. The 96-cell core grammar crosses source, joined, and
anti-joined filters; update and delete; Collection and Effect; acknowledgement
and rollback; one- and two-row windows; and indexed and unindexed loading.
Two indexed controls install the replacement independently of the query shape.
A non-prefix control installs rows 3 and 1 while row 2 is absent: deleting 3
must show `[1]` immediately, then acquire 2 and show `[2]`.

Eight histories settle acknowledgement or rollback before the held provider
answer, for source and joined paths and both consumers. Eight more mutate the
joined-side marker rather than the root, for joined and anti-joined paths,
both outcomes, and both consumers. The provider answer arrives after marker
settlement in those histories. The driver records the immediate public rows
and callbacks before yielding, provider acquisition while persistence is held,
the queued-answer and transaction-settlement cuts, the late-answer cut, and
two subsequent task turns. It checks both public rows and publication
sequences. A separate installed-extent model checks ascending heads,
descending offset windows, a tied head, and an exhausted window across both
outcomes. The tied case removes whichever equal-ranked key the initial public
window chose, avoiding an unsupported tie-break promise.

Four controlled histories use ascending limit-one on-demand joined and
anti-joined plans, the published #2148 shape. A rank-only acknowledgement is
an adjacent control, while a combined rank-and-membership departure checks
rollback. An acknowledged joined-side marker departure is followed by marker
restoration: source row 3 must return with a Collection or Effect publication.
This keeps marker eligibility distinct from source installation in the model.

The provider recorder keeps submitted IDs, requested order direction and
limit, real applied-receipt state, and every request's predicate, rank scope,
identity, phase, and progress. A required refill must submit the useful row
through a finite ordered request no larger than `width + 2` in this fixture.
Every pending indexed acquisition must have that bound or be a one-rank tie
probe. A source-filter request must reject an ineligible peer at a relevant
rank. A repeated identical request in the same settlement phase without a new
row fails. Distinct sequential tie or refill requests are allowed. The
six-row ledger makes full-source work distinguishable from a finite bound.
An emergency eight-request ceiling catches runaway work but is not a
fixed-point proof. Hostile checker controls reject no refill progress,
delayed Collection publication, stale post-settlement publication,
full-source overfetch, a missing source predicate, broad work after a valid
refill, and acquisition deferred until settlement. Named finite waits let a
stalled held event enter cleanup with its checkpoint intact.

The original loader behavior was reintroduced locally without changing the
oracle. The width-two indexed source-delete/Collection acknowledgement case
then failed at the intended cut: immediate `[3, 2]` instead of `[2]`, no
immediate callback, and a delayed settlement publication. Restoring the
loader change passes the focused histories. The exact #2169 mutation-handler
`utils.refetch()` path also runs through a real Query DB adapter and
QueryClient: only rows 3 and 2 are initially installed, so the immediate
window is `[2]`, not `[2,1]`; after the handler changes the provider row and
refetches, row 1 applies and the window becomes `[2,1]`. Temporarily restoring
the old loader classification fails this receiver at the immediate checkpoint
with `[3,2]`. The receiver also checks that the held callback snapshots remain
`[2]` and that the settled `[2,1]` window reaches subscribers. A temporary
observer mutant that discarded the final callback failed at that assertion.
Its request checker evaluates an unordered probe's uncapped predicate against
the full ledger and an added equal-rank peer; an orderless `limit: 1` cannot
masquerade as a rank-tie probe. With `TANSTACK_DB_ORACLE_SEED=1`, the complete ordered-work
owner passes 267 tests with no type errors; the Query DB receiving test also
passes with runtime and type checks. An unrelated generated history at seed `-1704903709`
fails both with and without this loader change; it is not claimed as a
regression or silently counted as green.

Three fresh independent oracle-review attacks identified the missing
joined-side, late-answer, explicit-installed-set, and bounded-request
distinctions; those are now executable. They also caught stale claims about
receipt timing and request-count stability, which this review and coverage
map correct.

## Boundaries and receiving work

#2148 does not publish its exact historical provider ledger or release
schedule. The controlled ascending limit-one joined/anti-joined histories
reach its stated shape, but the ordered-work owner still owns any recoverable
historical replay. `invalidateLoadedSubsets()` is introduced by open PR #2154,
not this revision; its Query DB owner needs a during-hold immediate-window
witness when that API is integrated. The installed
ascending, offset, tie, and exhausted cases establish immediate local
publication, not all provider-refill schedules for those windows. Provider
rejection, overlapping optimistic transactions, rank-only rollback and other
rank-move histories, real framework
render timing, and exact callback payloads remain separate obligations. A
provider-rejection continuation needs a Collection-versus-Effect contract
decision before adding expectations. The two post-settlement task turns are
bounded observations, not a universal no-retry proof.

## Oracle-guide accounting

This audit covers the change from published base `c4071fdba` through the
working-tree evidence above. Recheck the final commit after preparation; a
passing seeded run is not a claim about every generated history.

| Requirement | Outcome for this change |
| --- | --- |
| ORC-001 | The architecture's optimistic departure and settlement law is stated above; rank-only rollback, provider rejection, and the #2154 signal remain outside its accepted short-window exception. |
| ORC-002 | The controlled expectation filters, orders, and slices an installed-ID ledger. The Query DB receiver separately filters and sorts a remote row ledger; neither expected window imports loader classifications. |
| ORC-003 | The owner and receiver each state the law, model, legal fixture, real production path, public cuts, and comparison beside their code. |
| ORC-004 | Not triggered by the new fixed Cartesian matrix and pinned receiving test. Existing generated campaigns in the ordered-work owner are unchanged. |
| ORC-005 | The controlled owner reaches Collection and Effect rows/callbacks before yielding, at acquisition and settlement, and after a late answer. The receiver reaches the real QueryClient mutation-handler refetch and checks the immediate short window and the held and final callback snapshots. |
| ORC-006 | Restoring the old loader classification fails controlled source and ascending joined/anti-joined cases, and the real Query DB receiver, at immediate publication. Hostile checker observations reject no progress, delayed publication/acquisition, stale output, predicate omission, and broad requests. The receiver rejects an orderless page cap and a temporary missing-final-callback mutant. |
| ORC-007 | Not triggered by the new fixed matrix or receiver. The existing fixed/random campaigns in this file remain separate; the full owner passed at seed 1, while one unseeded-generated failure is known to reproduce without this change. |
| ORC-008 | Source installation and marker eligibility are distinct model facts. Restoring a marker after acknowledgement distinguishes an eligible hidden source row from a physically removed one. |
| ORC-009 | `installedIds` means applied source rows, not remote provider extent. `answerQueued` precedes application; a pending provider answer is not a public row. The receiver's remote ledger is provider authority. |
| ORC-010 | Held-event waits have named finite bounds and enter `withHistoryCleanup`; cleanup releases provider and persistence gates. A runtime test timeout outside those named waits is not evidence of a refinement mismatch. |
| ORC-011 | The real Query DB receiver is a second provider formulation for #2169's controlled premise. It does not stand in for the unavailable #2154 invalidation path. |
| ORC-012 | This table records applicable outcomes and non-applicable triggers; final-head verification remains required before a closure verdict. |
| ORC-013 | Missing, installed, and non-prefix extent; leading rejected rows; ascending joined and anti-joined windows; and late answers distinguish useful repair from no refill, broad fetch, or delayed publication at the named cuts. |
| ORC-014 | The controlled provider's queued answer and short-window premise reach a real Query DB mutation-handler refetch witness. The separate `invalidateLoadedSubsets()` handoff remains open with the Query DB owner after #2154 integration. |
