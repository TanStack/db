# Query source reuse oracle review — 2026-10-13

The reviewed code head is `b9f7afaba36a3e30dfc29cdc7cf966fcb6247aff`,
following the first repair at `52c8c04b4102fd9aae091e896acc3ba3de92b3d3`.
This record covers the bounded full-source reuse, retained-subset, and shared
signal additions in the Query DB lifecycle and ownership oracles. The record's
follow-up commit updates review evidence and coverage limits without changing
the reviewed code.

## Law, path, and checkpoints

The [Query Collection guide](../../collections/query-collection.md) and the
Collection [sync-adapter contract](../../guides/collection-options-creator.md)
authorize the laws. An applied complete full-source Query may serve a narrower
on-demand demand while its Query remains owned. Query Core success before
Collection application, an incomplete source, a failed source, or a retained
subset awaiting revalidation cannot establish that narrower demand. A row
remains public and durable while any committed Query owner needs it. Releasing
one acquisition aborts its signal, while another observer may keep the same
physical Query and provider transport alive. A provider that ignores the Query
signal can finish into Query cache after final observer release.

The [load lifecycle oracle](https://github.com/TanStack/db/blob/b9f7afaba36a3e30dfc29cdc7cf966fcb6247aff/packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts)
drives real QueryClient observers and Collection acquisitions. It checks
provider scope and call counts, public rows, acquisition settlement, error
state, and cached rows at named application, invalidation, release, and
held-fetch checkpoints. The
[ownership oracle](https://github.com/TanStack/db/blob/b9f7afaba36a3e30dfc29cdc7cf966fcb6247aff/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts)
uses controlled persisted storage and compares public rows, durable rows,
retention markers, and row owners when a retained subset reacquires. These
expected results come from complete source rows and ownership leases. They do
not copy the adapter's reuse gate, Query Core option selection, or retention
classifier.

## Distinguishing evidence

- The original #2135 code fetched a new filtered Query despite an applied,
  active full result. The settled-full witness failed at the provider-call
  checkpoint before the first repair and passed afterward. Initial and
  replacement full-result histories reject settling a filtered demand before
  Collection application; the replacement cut rejects relying on old applied
  rows while new result application is pending. Their acquisition promises
  remain pending at the held publication cut; a hostile immediate-settlement
  mutant fails both cases at that assertion.
- A controlled persisted `until-revalidated` subset remains independently
  marked until its scope is reconciled. Omitted, unchanged, and moved row
  histories check public and durable rows and marker removal at acquisition
  settlement. The omitted case was RED before the first repair. An executed
  hostile deletion of the moved row after its old subset owner retired failed
  both public and durable row comparisons; a retained old owner fails the
  moved-row owner comparison.
- Equal full and filtered peers, full-source dependents, and two Collections
  sharing one Query distinguish logical acquisition signals from physical
  Query ownership. Held initial and refetch histories put an equal filtered
  peer before or after fetch start, then release the creating acquisition.
  Before the second repair, three late-peer cases were RED at the public-row
  checkpoint. Exact, custom, and fresh `AbortError` cancellation now reach the
  peer; a no-peer release starts no replacement call. An initial ordinary
  provider error rejects the pending peer and sets `lastError`; a refetch
  error retains the prior applied snapshot and records `lastError`.
- The recovery-specific ignored-signal history was RED at the Query cache row
  checkpoint when the recovery guard read Query Core's lazy signal. Removing
  that read made it GREEN. Separate full-source and equal-filtered ignored
  signal controls show that final unload can leave a provider result cached.
  The SSR oracle keeps the sole direct request's exact metadata signal.
- Independent in-memory mutants reached their intended comparisons. Retrying
  every provider error failed the unrelated-error public-row check. Retrying
  only the exact signal reason failed both fresh-`AbortError` public-row
  checks. An eager lazy-signal read failed the recovered-cache check. These
  were assertion failures, not setup failures or timeouts. No mutant was
  checked into the repository.

The affected runtime and type suites passed **618 tests in six Vitest test files**
with no type errors. The Query DB package build passed. Changed-file ESLint
had no errors and ten warnings outside the changed lines. The finite matrix
and mutants establish only the named contract, histories, production paths,
and checkpoints; they are not a proof for arbitrary predicates or schedules.
The focused rerun command is `pnpm --filter @tanstack/query-db-collection exec
vitest run --coverage.enabled=false tests/load-subset-lifecycle-oracle.test.ts
tests/ownership-lifecycle.oracle.test.ts tests/ssr-dehydration-oracle.test.ts`.
The documentation link check still reports 32 existing links outside `docs`;
this record adds none of them.

## ORC-001–014 audit

| Requirement                       | Outcome for these additions                                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001 authority and limits      | Pass within the documented on-demand Query and controlled persistence boundary. Complete-source provider behavior remains a premise, not a fact proved for every backend.                                                                     |
| ORC-002 independent judgment      | Pass. Expected rows and owners derive from the authored source and lease graph, not production's reuse or retention branches.                                                                                                                 |
| ORC-003 literate responsibilities | Pass. Opening and local prose name the law, model rule, legal timing, real production path, observation, and settlement checkpoint.                                                                                                           |
| ORC-004 grammar controls          | Not triggered. These are fixed, bounded timing and value matrices rather than a generated-history claim.                                                                                                                                      |
| ORC-005 path and observation      | Pass. Real QueryClient and Collection paths reach provider, public-row, public-error, cache, and durable-row comparisons at the stated cuts.                                                                                                  |
| ORC-006 calibration               | Pass for the bounded claims. Original code and the hostile mutants above fail at their intended comparisons.                                                                                                                                  |
| ORC-007 campaign and replay       | Not triggered. No important generated property was added or changed.                                                                                                                                                                          |
| ORC-008 model-state minimality    | Not triggered. The reference ownership state was not split, combined, or expanded.                                                                                                                                                            |
| ORC-009 vocabulary mapping        | Pass. Prose separates logical demand, acquisition signal, observer lease, physical Query, transport, applied settlement, and durable row owner.                                                                                               |
| ORC-010 failure fidelity          | Partial. `try/finally` cleanup and caught pending loads release resources, but no injected cleanup fault proves that a cleanup exception cannot replace a primary mismatch. The fixed witnesses do not shrink or capture generated histories. |
| ORC-011 second formulation        | No second semantic formulation was required within the controlled boundary. Real provider completeness and abort shape need receiving witnesses under ORC-014.                                                                                |
| ORC-012 review evidence           | This versioned record ties the audit and mutant results to the reviewed code head; open cells are assigned below and in the coverage map.                                                                                                     |
| ORC-013 boundary witness          | Pass for the bounded laws: pending/applied full result, sole/shared and before/after fetch-start ownership, exact/fresh abort versus ordinary error, and omitted/unchanged/moved retained rows have distinguishing neighbors.                 |
| ORC-014 controlled handoff        | Open. The controlled provider and storage do not prove real network abort shape, complete unfiltered responses, or native SQLite cold retained replay. The coverage map assigns receiving witnesses.                                          |

## Scope that remains open

The adapter cannot distinguish a fresh `AbortError` caused by the creator's
signal from an unrelated fresh `AbortError` delivered after that same abort.
Its one-retry policy favors the surviving peer and can retry the latter once.
A stronger causal guarantee needs provider provenance; the oracle does not
claim one. A synchronous provider throw after reentrant peer acquisition has
no separate witness. The external `queryClient.cancelQueries` pending-load
settlement policy needs a public acquisition/status witness and is not a
confirmed bug from the current signal-state probe. The late-peer matrix
checks the surviving peer's promise; its retired creator's raw internal
`_sync.loadSubset` promise can fulfill after release. The guide's explicit
abort-then-reject rule addresses a request-scoped `commit(signal)` receipt,
and the existing public LiveQuery retirement oracle tests a different timing
cut. A public live-query preload witness for this late-peer cut and an explicit
raw adapter-settlement policy remain open.

The [coverage map](../oracle-coverage.md) owns further witnesses for arbitrary
predicate containment, function-built Query keys, TTL and native SQLite
retention, real network cancellation, cross-Collection Query option selection,
and the policy for an equal demand arriving after failed full revalidation.
The requirement that an unfiltered on-demand provider return the complete
source remains a maintainer contract and versioning decision. Source reuse
may retain and refetch a complete source rather than doing narrow work; this
finite correctness oracle does not establish a memory or request-efficiency
bound.

## Follow-up review of direct-write request scope

CodeRabbit review `5510417620` on head `486eac00a` found that the direct-write
witness at `load-subset-lifecycle-oracle.test.ts:449` filtered its provider-call
record to `full` requests. Its name claimed full-source reuse, while the test
could pass after an exact filtered request. The independent oracle reviewer
ran the real QueryClient path and observed `[full, filtered]`, with the promised
`a1` and `b1` rows public after preload. This is permitted by the Query
Collection guide: a direct cache patch is not a new fetched result for an
unacquired scope. The original settled-full witness, with no intervening direct
write, separately requires `[full]` and establishes reuse at that cut.

The oracle correction at code head
`a16fc95e42811ef25b457c86fab89059813851f5` names the direct-write law and
compares the entire request sequence. Its bounded history permits `[full]` or
`[full, filtered]`: one new filtered demand, a successful provider, and no
retry, invalidation, or explicit refetch need no second request. A hostile
production-path mutant called the filtered provider twice; the corrected test
failed at the request-sequence assertion on `[full, filtered, filtered]`. The
unmodified path passed **98 runtime and type tests** in the load-lifecycle file
with no type errors, and changed-file ESLint passed. No production code changed.
This correction strengthens ORC-003, ORC-005, ORC-006, and ORC-013 for the
direct-write witness. It makes no claim about every later demand or about
reuse after a direct write.

## Retained ownership exception and companion handoff

The guide's initial full-source reuse sentence omitted an accepted exception:
a narrower scope with retained persisted ownership needs revalidation before
its old row and owner can retire. The current adapter makes an exact-scope
request for that case. This follow-up clarifies the guide and changeset; it
does not change #2135 production code or the existing same-version retained
subset oracle. That oracle already crosses omitted, unchanged, and moved rows
after an applied full result and checks public rows, durable owners, and the
retention marker at subset settlement.

Companion #2134 code head `5239c25c2` adds a fixed historical-key handoff
with an active applied full Query. Marker-present and markerless variants both
pass on #2134 and in a scratch merge with #2135 head `d429e0dd8`. In that
merge, removing historical pending revalidation from the reuse gate fails
both variants at the immediate public-row assertion. Discovering old aliases
from markers alone fails only the markerless variant; the marked control
passes. The #2134 versioned review records the independent oracle challenge
and full evidence. The test permits either an exact request or safe
reconciliation from the applied full result, so exact request scope is not an
oracle requirement.

The follow-up law review found that exact request scope was stronger than the
retained-owner obligation. A complete full fetch started after retention and
applied before acquisition can also reconcile a current subset owner; an older
full result cannot. The matrix now permits either post-retention provider scope
and checks public and durable rows, owners, and markers at settlement and
release. A companion history first applies a fresh full result with a row
outside the subset, then acquires the subset and checks that the outside row
keeps only its full Query owner through a later invalidation. Explicit refetch
remains exact. The current adapter still uses an exact request for retained
current-key owners.

Removing the retained-revalidation gate in a scratch production mutant made
all eight stale-full matrix cases fail at the acquisition comparison. The
mutant reused the older full result, left the old detail row public and
durable with its subset owner and marker, and skipped the new provider call.
The unchanged implementation passed the 347-test ownership suite and the
Query DB type check. The new fresh-full history accepts an exact revalidation
after the full result; it does not prove that the current adapter can skip it.
A separate full-payload mutant sent an unfiltered result into an exact Query;
the fresh-full history rejected it at the list-only row's owner comparison.
The matrix allows extra successful provider attempts when their scopes are
valid, because this guide sets no one-transport bound.
An isolated full-route probe retired the old owner after the newly applied
complete full result and let the later subset share that full Query. The
fresh-full history passed; this fixture-specific probe is not a general
production repair.

A held-old-exact timing probe began an exact fetch, retired its owner into
persisted retention, then acquired the same scope while that fetch was still
pending. The acquisition stayed pending through the old response; a later
exact response applied before its owner and marker retired. Two freshness-gate
mutants also passed because this path started the later request for another
reason. This timing remains open in the ownership oracle. The guide states
that both exact and full revalidation require a fetch started after retention.

## Signal and cancellation design attack

The local physical-Query signal prototype passes the shared-owner histories,
but fails a legal sole public `requestSnapshot({ where, signal })` cancellation.
The caller can abort while its acquisition remains owned. The prototype leaves
the metadata signal live and can apply a late provider row. The previous
`#2135` fallback has a different failure on that same public path: after the
provider rejects `AbortError`, it mistakes the creator's own retained observer
for a surviving peer and starts a second provider call. The physical-only
patch and the old retry are both insufficient. This signal repair remains
uncommitted and requires a cross-Collection owner-aware cancellation oracle.

A separate public `utils.refetch({ throwOnError: true })` probe fulfilled with
the previous Query result after external `queryClient.cancelQueries()` canceled
its pending fetch. An isolated prototype rejected `AbortError` and passed 398
related tests, but the guide promises `AbortError` for application cancellation
and does not clearly specify external QueryClient fetch cancellation. The
cancel-A/start-B race is also untested. This is a bounded finding and a
contract decision, not closure of the broader cancellation class.

The direct-adapter same-options-object mixed-route diagnostic is red, but core
subscriptions create a distinct options object for each acquisition and pass
that same object to release. Its public receiving path has not been shown to
fail. The load-lifecycle oracle now states that identity premise instead of
adding route state for a direct-only ambiguous release.

## Public oracle challenge after the local prototype

The primary ownership oracle now drives `requestSnapshot({ where, signal })`
through caller abort with the acquisition lease still retained. A provider
that observes the metadata signal finds it live on the physical-signal
prototype. A provider that ignores cancellation returns a late row, which the
adapter installs publicly before `releaseSnapshot`. Both are red at their
named comparisons. The comparison also requires each aborted load to reject
with `AbortError`, as the load-subset transaction refinement oracle specifies
for every adapter cut. Both currently fulfill on the physical-signal prototype.
Query Collection is the sync adapter bound by the
request-scoped cancellation law in `types.ts`; a user query function may still
finish into Query cache, but its aborted request cannot install a Collection
row. A cross-Collection held-fetch witness verifies two observers share one
Query and the survivor receives the same provider response when one live query
retires. It passes the prototype and does not exercise explicit source
Collection cleanup, which can cancel a shared key.

A separate sole-snapshot history has a signal-honoring provider that rejects
`AbortError` on caller abort. The old `#2135` retry path starts a second request
with no peer and fulfills the load; this deterministic public witness passes
on the PR base and fails on `3502d3eca` in isolated scratch runs. On the local
physical-signal prototype, it fails earlier because the metadata signal does
not abort. Another public history lets two snapshot acquisitions share one
held Query. After the first caller aborts, the peer receives the row but the
aborted caller's load also fulfills. That settlement defect reproduces on the
PR base, so it is adjacent in-scope debt rather than a regression introduced
by #2135. A second branch aborts both callers while their leases remain
retained. After the ignored-signal provider returns one row, the local
physical-signal prototype fulfills both loads and publishes the row. The
primary oracle expects two `AbortError` rejections and no public row at that
checkpoint. This branch distinguishes logical request ownership from Query
observer count. Its targeted runtime check fails at the combined outcome and
row comparison with no type errors; a peer arriving after sole abort remains
outside this grammar.

An isolated hostile design supplies per-caller abort rejection but cancels the
physical Query only when its local owner and observer counts suggest no peer.
It passes the sole-abort, one-live-peer, and cross-Collection controls. When
both callers abort while their leases remain, both reject with `AbortError`,
but the late row still becomes public. The new branch rejects that mutant at
its public-row comparison, with one provider call. The focused scratch run had
five passes and one intended assertion failure. Scratch dependency links
prevented a valid typecheck there, so this is runtime calibration; the shared
candidate's focused typecheck reports no errors. The mutant is not a repair.

Fresh review also found two false-green assertions in the retained-owner
tests. When one provider call serves two equal live-query preloads, the second
must fulfill; the test now checks it. Failed exact revalidation must not
recover by reusing the older full result. The recovery history now holds a
new provider response and checks the old public row, durable row, and marker
while the load remains pending, then checks retirement after application.
Both corrected focused cases pass on the local candidate. Hostile mutants for
these two corrections also fail at their intended checkpoints in an isolated
checkout. One mutant rejects the joining preload after its peer's shared
provider call succeeds; the second-settlement assertion rejects it. A second
mutant fulfills a recovery acquisition before its held fresh response applies;
the pending-settlement assertion rejects it. A third clears the retained marker
in a valid storage transaction while that response is held; the pending
metadata comparison rejects it. The unchanged focused tests pass. The marker
mutant used a valid transaction because a direct metadata deletion violates
the persistence boundary and would be setup failure, not calibration.

## Cancellation follow-up candidate for independent review

This section records the uncommitted candidate based on
`f301084228c6bc8be82598ac0fafb88e69f97c2a`. It does not replace the
reviewed-head evidence above. The exact follow-up code head and independent
oracle verdict must be recorded after the candidate is committed and reviewed.

The [Query Collection guide](../../collections/query-collection.md) and the
Collection sync-adapter cancellation contract authorize two separate outcomes.
An aborted subset caller rejects with `AbortError` and cannot publish its late
row; a surviving acquisition keeps the shared physical Query fetch alive.
For an acquisition-driven on-demand fetch, the provider receives a native
physical signal as an enumerable metadata data property, including when its first
caller supplied no signal. An external Query Core observer may refetch a
retained Query after every Collection caller releases or aborts. That
independent fetch receives Query Core's live signal and may update Query cache
without making the canceled Collection acquisition live again.

The ownership oracle drives real public `requestSnapshot` callers through one
or both aborts while leases remain, a successor after sole abort, mixed
full-source and exact-refetch routes, and two Collections sharing one Query.
The late-peer history starts through a direct no-signal adapter acquisition,
joins through a public signaled snapshot, then releases the creator and aborts
the peer. It compares the physical signal before and after each release, the
peer's `AbortError`, and the absent late public row. An external refetch
history crosses a released no-signal creator, a released aborted-signal
creator, and a retained aborted-signal creator. It compares the provider's
native data-property signal, the Query cache's new row, and the Collection's
unchanged old row. The load-lifecycle
identity oracle records all semantic request fields while checking that the
new transport signal is a live native data property; this keeps its undeclared
window checks while leaving signal out of demand identity.

Two wrong designs were rejected at their intended comparisons. The
signal-bearing-at-fetch-start-only mutant left the no-signal creator's provider
without a signal; the late-peer oracle failed at the provider-signal assertion
with no type errors, then passed after restoring the candidate. An
always-Collection-owned controller for a zero-lease external refetch aborted
that independent signal; the external oracle failed at the Query cache row
comparison, then passed after distinguishing external Query Core ownership.
A later size-based ownership gate still treated one retained aborted route as
live. The third external-refetch case failed at the Query cache row comparison;
checking live signals instead of route count made all three cases pass.
The original physical-signal prototype's sole-abort and both-abort failures,
and the observer-count hostile mutant, remain documented above. None of these
mutants is checked in.

The Query DB package suite passed **38 files and 1,392 tests**, with no Vitest
type errors. The package TypeScript check, changed-file ESLint and Prettier,
React server-pagination and HydrationBoundary tests (**100 tests**), and
`git diff --check` passed. These checks ran after the latest cancellation and
replacement repairs. The production diff is positive because it keeps
two distinct ownership facts: local live acquisitions decide Collection
publication, while the physical Query's acquisitions and controller decide
transport cancellation across Collections. Route release and controller
bookkeeping share one path. A smaller equivalent representation remains a
review target.

Fresh code and oracle reviews found four adjacent histories. A distinct Query
Core observer joined F1 before the sole Collection caller aborted. On the
previous candidate, F1's metadata signal aborted and a signal-honoring provider
put that observer in `AbortError`; the new oracle failed at the signal check.
The repair recognizes independent Query Core observers and eager Collection
observers without treating an aborted on-demand Collection observer as a live
acquisition. A second red oracle released the sole aborted caller before F1
rejected. Its successor inherited F1's `AbortError`; the repair reuses F1 if it
succeeds and starts F2 if it rejects. Paired fulfilled/rejected provider
histories now pass, preserving the existing fast remount behavior.

Two read-only probes on the prior candidate exposed replacement timing. F2
could replace F1 while offline and paused, leaving F1's provider signal live
until F2's queryFn ran. The cache's fetch-start event now retires F1's signal;
the held offline oracle checks that boundary. In the other probe, an outside
Query Core observer started F2 synchronously from F1's cancellation notice.
F1's later terminal cache event aborted F2's controller. Terminal handling now
checks the Query's current idle state; the reentrant oracle checks F2's live
signal and eventual cache and public row. These two probes observed the faults
before the fixes; their new oracle tests passed on the repaired candidate.
The earlier guide section and two on-demand pagination examples now forward
the metadata signal. Descriptor assertions retain enumerable data-property
identity without requiring writable or configurable flags.

A later review challenged cancellation attribution when F1's queryFn itself
calls `cancelQueries()` and a subscribed outside observer starts F2 before
`observer.refetch()` returns. The new public-result oracle was RED while F2
was held: A stayed pending instead of rejecting `AbortError`. The adapter now
captures F1's retryer before calling the user queryFn. A separate three-caller
history was RED before F3 settled: A fulfilled with old data for default
options and rejected `CancelledError` with `throwOnError: true`, while B and C
waited. A now follows silently replaced F1 and F2 to F3, then waits for F3's
application. An F2-success callback that starts held F3 checks the other edge:
A and B return F2 while C remains pending, including equal and distinct F3
data. The uncanceled direct-write control checks that its refetch remains
pending through the write; the returned observer result can contain the
accepted cache patch. The reentrant cancellation matrix holds F2 across A's
rejection, then releases F2 and an ignored late F1, checking cache and public
rows at both cuts.

The first successor repair mishandled a silently canceled eager Query removed
from Query cache. The existing eight-case oracle failed because the old Query
has no same-Query successor; the repair again rejects its original caller with
Query Core's `CancelledError`. The focused new and existing histories pass.
The Query DB package suite passes **38 files and 1,400 tests**, with no Vitest
type errors. The package TypeScript check and changed-file ESLint have no
errors; source and oracle formatting and `git diff --check` pass. Fresh
independent review of this repaired snapshot remains to be recorded.

The next oracle review found a later outside-observer release that the first
held history omitted. The sole Collection caller aborts while an outside
observer keeps F1 alive, then that observer leaves before F1 settles. The new
branch failed at the immediate metadata-signal check: Query Core still had the
aborted Collection observer and did not cancel F1. The adapter now reevaluates
physical ownership on `observerRemoved`; the signal-honoring provider rejects
and no late row enters cache or Collection. The paused replacement history now
resolves F1 while F2 is offline, checks that its row stays absent, reconnects,
and checks F2's cache and public row.

A separate public application-boundary oracle exposed external cancellation of
`utils.refetch({ throwOnError: true })`. Query Core reverted to the prior
successful row and fulfilled `QueryObserver.refetch()` with that result, although
the held refetch had accepted no new data. The new oracle failed at the public
promise comparison. A newer success-position guard passed that witness but
failed when an outside observer started F2 from F1's cancellation notice: A
fulfilled with the old row while F2, Query cache, and Collection held the new
row. It also failed with an intervening direct write and when a second utility
refetch silently replaced F1: A returned the old row rather than F2's applied
result. Those new oracle comparisons were RED before the repair; a same-value
F2 and a successful direct-write overlap act as neighboring controls.

The adapter now observes the captured Query retryer promise for F1. A reverted
external cancellation rejects A with `AbortError` even if F2 succeeds; a
silent replacement makes A use F2's result and application record. The late
ignored provider response cannot publish after cancellation. Cleanup retains
its separate `CancelledError` outcome. A paused
fetch with an independent Query Core observer was also RED at reconnect:
the provider never ran. The adapter now lets that observer's Query Core signal
own the fetch, and the oracle checks its cache row and the canceled Collection
caller's absent public row. A new outside observer joining only after F1 was
canceled and external cancellation during the mutation-phase refetch boundary
remain separate contract questions.

The latest oracle revision exposed result attribution during synchronous cache
listener reentry. A listener registered before the Collection starts held F3
from F2's error event. With the default refetch option, B previously returned
the stale successful F0 result while A returned F2's error. Error and `null`
provider reasons failed at B's terminal-result assertion; both now pass after
the observer freezes a non-cancelled retryer's terminal error result before
the cache listener runs. A recursive fetch-event history starts nested B/F2
before outer A/F3's provider. Both F2 success and failure histories were RED:
A returned F2 instead of its own F3 result. The adapter now preserves the
uncancelled `observer.refetch()` result and its result-keyed application
settlement; both histories pass. A shared Query using an outside
`QueryObserver` for F2 now has a receiving witness: A and the outside observer
return F2 while C/F3 is held, then C, Query cache, and the Collection expose
F3. The reviewer's original outside-observer probe and the permanent oracle
pass on the repaired candidate.

The reviewer's later direct-write probe found a stale-result publication path.
An outside F2 starts before an accepted direct write. A cache subscriber
registered before the Collection starts F3 from F2's success event, so the
Collection sees F3's fetch event before F2's success action. On the prior
candidate, held F3 left F2's stale row in Query cache; an immediate F3 also
briefly published F2 between the local and fresh rows. Both schedules were RED
at the held-cache or publication-sequence comparison. The observer now records
F2's fetch position before cache subscribers run, and cache-success handling
uses that observation instead of the physical Query's later F3 position. Both
schedules pass, with F2 unable to displace the direct row and F3 able to
replace it. A same-reference manual cache write in the first subscriber is a
separate control: its transient cache value is not constrained, while its
public row stays local until F3. The earlier manual-observation cleanup also
passes that public control, so this control is not a hostile-mutant kill.

A fresh code review found the neighboring observer-order gap. If an outside
`QueryObserver` was subscribed before the Collection, its F2 success callback
could start F3 before the Collection observer saw F2's terminal result. On the
next candidate, both a successful and a failed held F3 were RED at the held
Query-cache checkpoint: stale F2 replaced the accepted direct cache row while
the Collection kept the local row. The failed F3 left that stale cache row
durably. The cache-success action now takes the oldest pending physical fetch
position and overlays accepted direct keys when the Collection observer missed
that terminal result. Both histories pass at the held cut and after F3's
success or failure. This still exercises direct `_sync.loadSubset` acquisition
with the installed Query Core; a live-query receiving path remains open.

The neighboring silent-replacement schedule exposed the other side of
physical fetch attribution. F1 was silently canceled, a direct write was
accepted, and F2 started after that write. An earlier outside observer started
held F3 from F2's success callback. The first candidate left both Query cache
and the Collection on the direct row; the next candidate corrected Query cache
but left the Collection on that row. The new oracle was RED at its held F3
checkpoint in both candidates. The adapter now retires F1's pending physical
fetch position when its silent replacement emits no terminal action, then
replays F2's missed observer result after its cache success action. The held
checkpoint has F2's row in cache and Collection; after F3 succeeds and F1's
ignored late response arrives, both have F3's row. This history bounds the
older-fetch overlay: a fetch that starts after the direct write may replace
that row.

The next frozen review found two more legal notification orders that the
pending-fetch queue misclassified. First, an outside observer registered
before the Collection started F2 from a manual cache write while F1 was still
pending. The manual action reached this Collection after F2's fetch action.
F2 began after an accepted direct write and returned `newer`, but the prior
candidate kept `local` in both Query cache and the public Collection while F3
was held. Second, F2 failed and that earlier observer started F3 from its
error callback. F3 began before a direct write, then returned stale data and
the observer started held F4. The prior candidate published stale F3 over the
direct row; F4 failure left it there. The three new matrix cases were RED at
the held public/cache comparisons, and the F4-failure case also failed its
terminal comparison. The adapter now tracks data, manual-data, and error
updates from each physical fetch start. A later fetch only retires its
predecessor when no fetched success or error has occurred; a delayed manual
notification rechecks that retirement. The new held and terminal comparisons
pass. This controlled matrix remains bounded to Query Core's synchronous
observer/cache dispatch in the installed version.

An equal-value F2/F3 experiment that appended a held promise after the real
`commit()` had already published was discarded. Its returned promise did not
obey the applied-receipt contract, so its early-refetch outcome is not product
evidence. The earlier same-result subscriber-reentry test used that same
post-publication decoration, so it was removed from this product oracle. Its
fulfilled delay was an extra acknowledgement after visibility; its rejected
delay contradicted the applied-receipt contract. A real persisted receiving
witness must hold durability before the wrapper invokes core commit, reenter
from the outer publication, and compare the caller's settlement with both
public and durable rows. That law remains open; the removed fixture does not
establish it.

The next review found a terminal Query success with no eligible Collection
application. A custom persister called the source function, but Query Core
correctly left the returned value's provenance unknown because the persister
could return unrelated data. With an `until-revalidated` marker, direct
`loadSubset` and public live-query `preload()` both fulfilled while the old
durable row and marker remained. The four new ownership witnesses cross cold
and seeded Query caches. The cold witnesses were RED at
the public promise checkpoint and now require explicit rejection. They also
compare the old public row, durable row, marker, Query cache, and one provider
call. The adapter rejects an unattributable terminal result instead of treating
Query success as Collection applied settlement. A source function side call
does not prove the persister's returned value.

The cleanup-tail review found two resource boundaries. First, F1 can succeed
after Collection cleanup and cause an outside observer to start held F2 during
F1's result notification, before F1's cache event. The new load-lifecycle
witness requires the Collection cache watcher to be gone while F2 remains
fetching. A status-gate mutant failed there because it used F2's current
`fetchStatus` to decide whether F1 ended. Second, a retained outside observer
can call the captured adapter query function repeatedly after cleanup. An
instrumented five-refetch probe observed operation-map sizes 1 through 5 on
the earlier candidate; after the repair it observed five zeroes. No test-only
export is added to the package. The watcher retires the terminal event's
operation, and a captured query function does not record independent work
when no Collection cache owner remains.

The next oracle review found that the opaque-persister fixture only forwarded
`runSource`, although its law allowed the persister to discard that result.
The ownership matrix now also invokes `runSource` speculatively and returns an
unrelated row. All eight cold/seeded and direct/live-query cases reject while
the Query cache contains exactly the persister's chosen row and the durable
owner and marker remain. This calibrates the premise without assuming a source
invocation proves returned-value provenance.

A held-source history then exposed a false readiness cut. `setQueryData` during
the fetch made the Query observer report success, and both direct load and
live-query preload fulfilled before the source response. Four new oracle cases
were RED at the pending-promise checkpoint. The readiness wait now requires a
terminal physical Query result for a retained owner. An ordinary source result
then applies and clears the marker; a terminal opaque persister result rejects
and preserves it. The complete aliased Query DB suite passes with 923 tests.

A separate two-Collection history exposed a cleanup watcher claiming another
Collection's successor fetch. B started held F2 inside an outside observer's
F1 success callback while A cleaned up before F1's terminal cache event. A's
watcher stayed subscribed beside B's live cache listener. The new oracle was
RED at its held-F2 cache-subscription checkpoint. Cleanup now removes A's
cache-owner token first and installs a tail watcher only when no Collection
cache owner remains. The witness passes with one B listener during F2 and
after F2 settles. B's later F3 publishes through B, and B's final cleanup
leaves zero cache listeners; those checks reject a leaked A watcher hidden by
the earlier count. This does not prove arbitrary Query Core notification orders.

An outside Query observer can start F1 before a persisted Collection exists.
The Collection then restores a retained full owner and acquires it through
direct load or public live-query preload. Both paths were RED at the public
promise checkpoint: they fulfilled before an eligible result applied. The
repaired cold path waits for F2; while F2 is held, its old public and durable
row and marker remain. A reviewer found that an earlier four-case matrix did
not actually vary retention order at the production boundary: making an
unconnected storage object before F1 changed no observed state. The final
oracle retains the two F1-before-Collection paths and leaves the connected
retention-before-F1 order open in the coverage map.

A public exact `requestSnapshot({ where, refetch: true })` exposed a separate
cancellation error. After F0 applied, Query Core canceled held F1 and reverted
its Query to F0. The adapter's refetch promise fulfilled from that old row;
the new oracle was RED at the public promise checkpoint. Capturing F1's
physical retryer cancellation makes that caller reject instead. The neighboring
silent F1-to-F2 replacement history requires both exact refetch callers to
remain pending while F2 is held and then wait for F2's applied row. An
independent reviewer ran an early-fulfillment mutant, which failed at that
held-F2 promise comparison. The existing released-retained-result
test requires its creator promise to remain pending while the persisted scan
is held and the demand is owned, then reject with `AbortError` after final
release. No row owner or public row may be installed.

The complete aliased Query DB suite passes **927/927** tests against Query
Core `58c443442c6964bf6b86fe1d7d31868b87226cc5`. The package TypeScript
check, formatting check, and `git diff --check` pass. Changed-file ESLint has
no errors and 30 warnings, none introduced by the two exact-refetch histories.
The installed Query Core 5.90.20 lacks the attribution APIs required by this
branch's runtime guard, while the package peer range still accepts versions
starting at 5.90.15. Updating that range and the lockfile requires the first
published Query Core release containing the attribution work in #12023. This
remains a release blocker; the aliased test result is not an ordinary-install
compatibility result.

Relative to the published branch, production changes in `query.ts` are
**+1,017/−161 lines (net +856)**; tests are **+5,041/−325 (net +4,716)**;
contract documentation and the changeset are **+677/−161 (net +516)**.
Physical Query work can outlive or be shared by Collection acquisitions, so
the physical fetch state cannot be represented by one logical demand count.
Query success can precede Collection application, so an applied-result ledger
cannot be replaced by the Query's success status. Direct-write acceptance and
source invocation have separate order, so one row position is insufficient.
The two refetch entry points share retryer cancellation attribution but have
different settlement obligations: one exact acquisition versus a public
multi-Query utility call with per-result application and mutation/recovery
gates. A common full-outcome path would combine those obligations; extracting
only capture setup would remove little state. No safe removal has been shown
for this candidate.

| Requirement                       | Follow-up status before independent review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001 authority and limits      | The public abort and Query cache laws above are bounded to one QueryClient and the installed Query Core version. Mutation-phase cancellation and late outside-observer joins remain open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ORC-002 independent judgment      | Expected caller outcomes and rows come from leases and authored provider responses, not the adapter's route or controller branches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ORC-003 literate responsibilities | Local prose beside each new history names its legal timing, production path, observation, and comparison checkpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ORC-004 grammar controls          | Not triggered by the new fixed timing histories. The existing two-snapshot matrix remains bounded as documented in the coverage map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ORC-005 path and observation      | Real QueryClient, Collection subscriptions, and direct adapter entry points reach public promise, public row, provider signal, and Query cache comparisons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ORC-006 calibration               | Independent-observer, released-successor, later observer removal, public utility-refetch, cancel-A/start-F2, overlapping utility result, synchronous queryFn cancellation, three-caller silent replacement, pre-registered F2 error, recursive fetch-event result, paused outside-observer, stale F2 versus reentrant F3 direct-write tests, the outside-observer-first cache test, the silent-F1/post-write-F2 reentry test, and the manual and error action-order matrix cases failed on prior candidates at named assertions. The eager cache-removal owner rejected the first successor repair. Their comparisons pass after repair. The same-reference manual cache-write control does not kill the earlier manual-observation cleanup. Both delayed-after-publication receipt cases were removed as invalid collaborator signals.                                                     |
| ORC-007 campaign and replay       | Not triggered; no important generated property changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ORC-008 model-state minimality    | Not triggered; no independent reference-model state changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ORC-009 vocabulary mapping        | The prose separates acquisition, physical Query fetch, Query Core observer, Collection publication, and Query cache settlement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ORC-010 failure fidelity          | Fixed histories clean up held responses and observers. An injected cleanup-fault calibration remains open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ORC-011 second formulation        | No new shared-fault hypothesis requires a second semantic formulation for these fixed boundaries. A real network provider remains a separate receiving path under ORC-014.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ORC-012 review evidence           | Candidate evidence is recorded here; exact reviewed head and independent verdict are pending. No bug-class closure is claimed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ORC-013 boundary witness          | No-signal and signaled creators, one/both caller aborts, independent observer retained and removed, released successor with both provider outcomes, paused replacement with late F1 and resumed F2, paused outside-observer fetch, reentrant replacement, synchronous queryFn cancellation, two- and three-caller silent replacement, F2 terminal success and error before held F3, recursive fetch-event reentry with F2 success and error, an outside-observer F2 provider, same-value data, held and immediate stale F2 versus F3 direct-write schedules, an outside-observer-first F2/F3 success-and-failure pair, silent F1 followed by post-write F2 and held F3, earlier-observer manual and error reentry with held successors, same-reference manual cache-write control, eager Query removal, and zero-live-acquisition external refetch distinguish nearby ownership boundaries. |
| ORC-014 controlled handoff        | Open for real network cancellation, mutation-phase external `cancelQueries()` settlement, and Query Core versions beyond the installed dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

The [coverage map](../oracle-coverage.md) assigns the remaining late-peer raw
`_sync.loadSubset` creator-settlement question, external
`queryClient.cancelQueries()` during a no-signal snapshot, mutation-phase
utility-refetch cancellation, real network provider, option-selection orders,
late outside-observer joins, direct `fetchQuery()` joins without a subscribed
observer, and cleanup-fault witness. No general cancellation closure is claimed.

## Independent review of the follow-up commit

The follow-up commit `d145b16af4e801735102971cd90874ff8102041f`
contains the frozen tracked diff
`ff7e86ad0a83d46800c04a62171883d50cc27f1b7251f653b744becc2d8fd3f4`.
The independent code review found no confirmed public counterexample in its
production-equivalent candidate and passed a nested earlier-listener refetch
probe. The independent oracle review found no remaining false green in the
named controlled paths on the committed code. It killed a stale-F1 retained
fulfillment mutant, an early exact-refetch fulfillment mutant at the held-F2
checkpoint, and a false-success startup-release mutant at the `AbortError`
assertion. This supplies the bounded independent verdict that was pending in
the candidate table above; connected retention-before-F1, native persistence,
real network cancellation, and mutation-phase external cancellation remain
open in the coverage map. The Query Core minimum version remains unresolved
until #12023 has a compatible published release.
