# Initial ordered fallback readiness (issue #2152)

Reviewed code commit: `bb1ed1d87ffb2de1b27b8a024fc402d2755dcb26` (parent
`91cefa2602cf35929cbc5402f6afd7c8dbe9c88d`). This record and the final
coverage-map limit are documentation follow-ups to that code commit.

## Contract and finding

The initial synchronous cut in
`packages/db/src/query/live/ARCHITECTURE.md` covers every acquisition needed
to complete an unpublished first ordered window. A provider-ordered prefix
whose locale-string or null boundary cannot form a cursor may need a
full-source fallback. When each request returns literal `true` after its rows
apply, the rows and `ready` status are owed before the initiating `preload()`
returns. A Promise fallback stays asynchronous. The cut does not promise a
render-time result for a deferred on-demand React source or synchronous timing
for repair, replay, or a later window operation.

The old warm null-boundary test read status before `preload()` started
acquisition. It therefore accepted `loading` without observing the promised
cut. The loader also classified a full-source request as initial only if no
earlier source request had settled. That excludes the fallback after the first
ordered page. The revised oracle starts the sync run and records request shape.
It reads public state at fallback entry and immediately after `preload()` starts,
then compares again after settlement. Its two-row ISO-string reference predicts
row 2 for distinct dates and row 1 for tied dates with a public-key tie-breaker.
It does not use the production comparator. The warm null case checks an already
installed source, where the continuation has no new row input to drive another
graph turn.

The independent oracle reviewer found two gaps before production changed.
First, the architecture said full-source repair always settles
asynchronously, although the prior design review left that timing open. The
architecture now states the actual atomic-publication obligation without
fixing repair scheduling. Second, the new index cells could both have used
the same ordered request path. The first request now checks offset `0` for
the indexed page and no offset for the unindexed prefix. The reviewer found
no remaining blocking issue in the revised architecture, oracle, and coverage
map. The reviewer inspected the path discriminator; no index-selection mutant
was executed.

## Executed evidence

| Revision and path | Checkpoint and result |
| --- | --- |
| Parent commit, focused DB oracle | Three intended assertion failures: eager and unindexed locale-string literal-`true` cells returned empty `loading`, and the warm null-boundary case returned empty `loading`. Promise and zero-window neighbors passed; all four index-path shape assertions passed after they were added. |
| Parent commit, React eager receiver | The first layout commit returned `id: undefined`, `status: loading` instead of row 2 and `ready`. An attempted on-demand React first-commit fixture issued no requests by that commit, so it was replaced with the eager receiving path; it is not evidence about the loader gate. |
| Reviewed code commit, focused DB oracle and React receiver | Eight focused DB cells and the React first-commit witness passed. |
| Reviewed code commit, broader tests | 427 ordered DB tests passed across the lifecycle, loader-state, and work owners; 78 React conformance tests passed. Both package TypeScript checks, Prettier, and `git diff --check` passed. ESLint had no errors and two warnings on unchanged lines. |
| Adversarial follow-up, controlled adapter | All 268 ordered lifecycle tests passed, including eight index × settlement × row-order cells. The fallback request has no predicate, order, limit, cursor, or offset. The public rows remain empty and status stays `loading` at fallback entry. |
| Adversarial follow-up, Query DB receiver | Both focused warm ordered tests passed. A warm cache returned literal `true` on both raw adapter calls. Row 2 was visible at the first return, rows 1 and 2 at the fallback return, and the receiving `findOne()` was immediately ready with row 2 without another fetch. Vitest reported no type errors. |
| Event follow-up, controlled adapter | All 276 ordered lifecycle tests passed, including eight subscriber-event cells. Each observes one completed-window insert after fallback settlement, with the complete row visible in its callback. Promise cells have no nonempty event at the immediate cut. A temporary duplicate-event fault fails all eight cells at the publication comparison. |

Four independent oracle reviewers challenged the contract, request path,
observation checkpoints, and receiving boundary. They found three false-green
gaps in the original four cells. A locale-string cursor mutant passed them
because the oracle omitted the fallback's `where` predicate. A mutant that
dropped fallback source changes also passed the original 264-test lifecycle
suite because distinct dates kept row 2 as the winner. The original oracle
did not read public rows when the fallback started. The new request assertion,
tied-row dimension, and entry checkpoint close those gaps for the eight cells.

The locale-string cursor mutant now fails all eight cells at the request-shape
assertion. The dropped-fallback-changes mutant fails all four tied-row cells at
the public-row comparison: it returns row 2 instead of row 1. A synthetic
early-publication fault fails all eight cells at the fallback-entry read. These
were comparison failures, not setup failures or timeouts. That state read alone
cannot reject a transient or duplicate event after fallback entry. A separate
subscriber-event assertion now records nonempty change batches across the same
eight histories. A temporary duplicate-event fault fails all eight new cells
at that assertion. Empty readiness callbacks do not count as row publication.

The original `!hasSettledSourceRequest` gate is the calibrated wrong design:
it reaches both acquisitions but fails the immediate comparison, then passes
after settlement. The production repair preserves the existing exclusions for
ordering repair debt and explicit window operations from the synchronous path.
Its original production diff is five added and three removed lines, net two.
Test and contract prose are accounted for separately.

## ORC-001 through ORC-014

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The authority is the architecture's initial-readiness cut. The owner states that source exhaustion and React render timing are outside the controlled oracle. The separate Query DB test covers a warm real adapter handoff. |
| ORC-002 | Expected ids come from two fixed ISO dates, a descending singleton, and the public-key tie-breaker; synchronous versus Promise readiness comes from the contract. Neither the loader's cursor classifier nor production comparator computes the reference. |
| ORC-003 | Opening and local prose distinguish the law, eight-cell grammar, independent reference, live Collection driver, fallback-entry and immediate observations, subscriber changes, and refinement checks. The warm test explains its no-input continuation. |
| ORC-004 | The finite index × fallback-settlement × row-order matrix runs eight state cells and eight event cells, not a new generated-history claim. Request offsets establish distinct index paths. The existing generated lifecycle grammar was unchanged. |
| ORC-005 | `createLiveQueryCollection()` and `preload()` execute the real core path. The recorder captures both requests before the immediate public `toArray`/`status` comparison. A subscriber registered before the first source write records public change batches without moving the preload cut. The controlled adapter honors predicates, and its writes and `commit()` precede literal `true`. |
| ORC-006 | Unchanged production fails three assertions at the intended immediate checkpoint and passes after the fix. Two plausible production mutants and two synthetic publication faults fail at their intended comparisons in the stronger cells. None is a timeout or setup failure. |
| ORC-007 | Not triggered by the new finite cells. The owner's pre-existing fixed and random campaigns are unchanged and ran in the broad suite. |
| ORC-008 | No stateful reference-model state was introduced or revised; the new reference is a stateless observation over settlement and row order. |
| ORC-009 | “Initial chain” maps to the ordered acquisition plus fallback before first publication. `rows` and `status` are public observations, not model state with a production counterpart. |
| ORC-010 | `finishOracleCleanup` releases the event observer, live Collection, and source Collection while retaining a primary mismatch and separate cleanup errors. The owner's failure-fidelity test remains in the passing broad run; no shrinking is used for the finite cells. |
| ORC-011 | A locale-string cursor mutant exposed a shared request-shape blind spot in the original oracle. The revised oracle rejects it and requires the controlled provider to honor the request predicate. The Query DB warm-cache receiver checks a separate adapter path. |
| ORC-012 | This record identifies applicable obligations, non-applicable triggers, the exact reviewed code commit, and the bounded bug-class result. |
| ORC-013 | Literal `true` versus Promise separates the synchronous boundary; indexed versus unindexed acquisition, distinct versus tied dates, and a warm null boundary are adjacent legal witnesses. The event cells require one final publication after fallback settlement and no Promise publication at the immediate cut. The old gate fails two string cells and the warm cell at the named cut. |
| ORC-014 | The controlled adapter's premise is an applied receipt followed by literal `true`. The Query DB warm-cache test witnesses two real adapter returns of literal `true` with source rows visible at each return and an immediately ready receiver. React's eager source supplies a separate first-commit witness. |

## Bounded result

The repair is evidenced for the fixed indexed and unindexed locale-string
`findOne()` histories, distinct and tied rows, a warm null boundary, Promise
fallbacks, an eager React first layout commit, and a warm Query DB adapter
handoff. The Query DB witness covers cached subsets. It does not establish a
first-commit React result for a real on-demand provider or other adapters.
The event assertion covers the eight controlled fallback histories. It does
not establish every event ordering or another provider's publication path.
No reachable counterexample remains in the executed core and receiving paths
at their stated checkpoints.

## Follow-up review of the readiness proxy

A seven-item code-reading review targeted `6bc943992`; the evaluation used
`1e4bba40c` after a type-only test fix. The
accepted law promises a synchronous result for a first ordered window whose
required acquisitions return literal `true` after their writes apply. It does
not require a later full-source acquisition to settle asynchronously. A later
request without ordering-repair debt may finish in the same graph turn.

A public probe reached the reviewer's publication/readiness distinction: a
joined-filter window published row 1 while a pending child demand kept the
live-query Collection `loading`. Removing row 1's join match requested another
ordered page, received a null boundary, then requested the full source after
that first publication. The original `!canRetryRepair()` check classified it
as initial, but its public rows and change event remained coherent. The
reviewer's suggested insert alone did not make a full window need more data.
In a separate ready post-publication probe, dropping the check changed only a
transient `isLoadingSubset` observation: the final row was 2 in both versions.
The revised loader uses `isFullSource && !needsOrderingRepair` for synchronous
eligibility, leaving retry policy with its own callback. The full-source
repair and explicit-window exclusions remain in place.

An async first page followed by a literal-`true` fallback tested the claimed
request/observe race through a public live-query Collection. Synchronous
fallback writes left status `loading` and rows unpublished until `observe()`
ran; after preload settled, it was `ready` with the expected row. A direct
loader probe could flip a mock callback during `request()` and change the
branch, but did not establish that transition on a legal public path. Removing
the callback from this branch also removes that sensitivity.

The old ordered lifecycle owner accepted a mutant that removed the readiness
clause: all 276 tests passed. That mutant is permitted by the documented
timing law, so its survival does not expose a missing required timing
assertion. The retained initial cells still reject the old
`!hasSettledSourceRequest` gate at the immediate public checkpoint. A new warm
null-boundary cell covers a constructor-started on-demand sync run: it sees the
first ordered request, but not the fallback or publication, at the immediate
preload cut; after settlement it sees both requests, the four expected rows,
and `ready`. The adjacent preload-started cell remains synchronously ready.
The focused warm cells and all 277 ordered lifecycle tests passed with no type
errors. Other adapters and a real on-demand React first commit remain outside
these witnesses.

## Post-publication oracle follow-up

Reviewed oracle and coverage-map commit: `44cf62e2d9597e2a58a213d24c31e8733fdd2884`
(parent `3aca442c6549048246379661f2dcc133f12d0d53`). This section is a
documentation follow-up to that exact code revision; the earlier ORC table
describes the initial-fallback change.

The ordered-lifecycle oracle now exercises the publication/readiness distinction
through the public live-query Collection. Its finite model joins three root
rows to marker rows and takes the first eligible row in nulls-last order. An
on-demand child holds Collection status at `loading` after root 1's first
window publishes. Two legal marker histories, deletion and retargeting, remove
root 1's match. The next ordered page supplies ineligible root 2 at a null
boundary; a later unfiltered full-source request supplies eligible root 3.
The controlled adapter evaluates request predicates and cursor expressions,
sorts the requested page, and applies its writes before returning literal
`true`.

The oracle checks the already public row and `loading` status at fallback
entry, the pending child acquisition, the ordered page before the full-source
request, the final public row, and the net delete/insert events. Its explicit
`getKey` uses the root ID, so the comparison does not depend on the compiler's
composite-key encoding. At each nonempty event callback, applying its changes
to the prior public snapshot must reproduce the rows read in that callback.
The net comparison allows either order for changes to distinct keys. It waits
for the final public change rather than a fixed number of scheduler turns. It
also keeps every callback-visible window within the one-row limit. The
refinement check runs before cleanup so its mismatch remains the primary
diagnostic if cleanup fails. It allows coherent intermediate publications and
makes no
synchronous-timing claim for work started after first publication. A temporary
fault kept the full-source request and its reported served rows but dropped
the newly delivered root 3 write. Both histories failed at the final public
snapshot: the faulty run showed `[]` and `ready` instead of root 3 and
`loading`. The fault was removed after calibration.
Another temporary fault duplicated the recorded public event batch. Both
histories failed at the net change-event comparison while their final rows
remained correct; this fault was also removed.

At the reviewed code commit, all 279 ordered lifecycle tests and the DB test
TypeScript check passed. Prettier and `git diff --check` passed. ESLint had no
errors and one warning on an unchanged line. An independent source review
found and prompted repairs to the key-encoding assumption, event order,
page-before-fallback reach, pending-child reach, fixed-turn wait, callback
window bound, and failure fidelity before this commit.

This is a controlled core witness for these two marker actions and one null
boundary. It does not establish other provider delivery schedules, real
adapter handoffs, or a first React commit over an on-demand source. The
initial synchronous-cut histories above retain those separate limits.

| Requirement | Post-publication outcome |
| --- | --- |
| ORC-001 | The architecture's coherent-publication and pending-demand laws govern this later fallback. The synchronous first-window cut expressly excludes work started after publication. |
| ORC-002 | The expected row comes from a finite marker join, nulls-last sort, and one-row slice. It does not call the loader or its ordering classifier. |
| ORC-003 | Prose beside the model and driver names the law, two-action grammar, controlled production path, public cuts, and refinement check. |
| ORC-004 | Not triggered: these are two enumerated histories, with no generated-history coverage claim. |
| ORC-005 | `createLiveQueryCollection` and `preload` reach a published row with a pending child acquisition, then an ordered cursor page before the unfiltered full-source request. Public callback rows and changes are compared after the needed row is delivered. |
| ORC-006 | A temporary dropped full-source write failed both histories at the final public-row comparison; a temporary duplicate event failed both at the net-event comparison. Both faults reached the fallback and were removed. |
| ORC-007 | Not triggered: the owner's existing fixed and random campaigns were unchanged. |
| ORC-008 | Not triggered: the new model is a stateless finite recomputation. |
| ORC-009 | A marker mutation is one source Collection sync transaction; the model's eligible result is the live-query Collection's public row. A pending child request keeps Collection status `loading` after publication. |
| ORC-010 | The comparison runs before cleanup. `finishOracleCleanup` retains a primary assertion and distinct cleanup failures; the child gate is released and every Collection and observer is cleaned up. |
| ORC-011 | No shared semantic fault requiring a second result formulation was identified. The reviewer found an internal-key encoding dependency; explicit `getKey` removes it. |
| ORC-012 | This section records the exact code revision, checks, faults, and bounded claim. |
| ORC-013 | Not triggered: the evidence claims only two named marker actions and one null-boundary path, not a reusable timing or range law beyond them. |
| ORC-014 | No real-provider handoff claim is made for this controlled later-fallback path. Other adapters and on-demand React remain separate receiving limits. |

## Post-publication response schedules

Reviewed oracle and coverage-map commit:
`762a29a4e777629470b9011a6c17e537401f005d` (parent
`06ba31eaeecd44e5172391bbde9d3a72957ea29e`). This section supplements
the two-action post-publication record above; no production code changed.

The finite grammar now runs eight histories. Marker deletion and retargeting
each cross a literal-`true` fallback, a Promise result after applied writes,
and a fallback returning its held applied receipt while child demand remains
pending. Each action also runs the held receipt after the child demand settles.
All histories first observe row 1 published while that child demand still keeps
the live-query Collection `loading`. The ready-child histories then await the
initial preload and observe row 1 with `ready` status and no subset load in
flight before changing the marker.

The held-receipt provider starts an optimistic update to an unselected root
field after the ordered page applies. While its persistence is pending, root
3's full-source sync transaction has a pending applied receipt and root 3 is
absent from the root Collection. The ready-child histories observe the public
root and live-query `isLoadingSubset` flags become true at this held cut. After
releasing the update, the driver waits for the public row-3 change and the
relevant public loading-end signals before comparing the final window and
change events with the finite join model. The marker mutation may publish an
empty intermediate window or retain row 1; callback replay checks that each
observed event matches its public snapshot. The final net delta must contain
one delete for row 1 and one insert for row 3.

A temporary loader fault ignored the pending applied receipt while retaining
the provider writes. All four held-receipt histories reached the comparison
and failed at the public live-query loading flag: the faulty run reported
`false` while the root receipt was still pending. The fault was removed. The
normal eight focused histories and all 285 ordered lifecycle tests passed;
DB test TypeScript, Prettier, and `git diff --check` passed. ESLint reported no
errors and one warning on an unchanged line. Two independent oracle reviewers
found and prompted repairs to an overstrict old-row intermediate assertion, a
tautological response-kind check, unwitnessed blocker startup, dropped cleanup
diagnostics, and a final checkpoint tied to one scheduler turn. A final
read-only check found no race or cleanup defect in the revised event wait.

The Promise-after-applied-writes history exercises the asynchronous callback
path and checks eventual public coherence. The architecture gives later
full-source work no initial synchronous cut, so this case does not distinguish
that Promise from a literal return at an immediate public checkpoint. A held
Promise after applied writes with overlapping source changes remains for this
owner to witness. The held `isLoadingSubset` comparison proves the public load
tracker retains the applied receipt; it does not alone prove that every ordered
publication participant waits for it. The row and event comparisons cover the
named final checkpoint. Real provider handoffs and an on-demand React first
commit remain outside this controlled core witness.

## Later-fallback re-review at `cdc370b04`

The initial synchronous cut ends when the first window publishes. A later
full-source fallback without ordering-repair debt may complete in the same
graph turn, but the contract does not require that timing. A controlled public
probe observed row 3 and its change event before the marker transaction's
`commit()` returned for literal `true`. Promise and held-receipt responses had
not published row 3 at that cut. The oracle retains its coherence law across
both schedules instead of turning the current later timing into a guarantee.

Two additional histories make the first ordered acquisition's adapter unload
throw while a later literal-`true` fallback replaces it. The marker
transaction's `commit()` still returns `true`; the successful row-3 window and
its change event remain, and the live-query Collection reports `error`. A
temporary fault that rethrew the already reported release error from the
subscriber failed both histories at the marker commit. The direct loader's
release-error tests continue to check its separate caller boundary.

The controlled providers now record applied-receipt shapes and compare them
after production returns. Deliberately reversing one assertion inside the
provider had previously produced six unrelated setup failures among the eight
post-publication histories, showing how request-failure handling could hide
the intended diagnostic. The architecture's prior statement that full-source
repair keeps asynchronous settlement was restored; the untested broad
publication-hold sentence added during this PR was removed. The changeset
names the permitted later completion. Framework render timing remains outside
the core cut, and the React first-layout-commit witness does not claim to
cover Vue, Solid, Svelte, or Angular.

## Held provider Promise across a later marker change

Reviewed oracle and coverage-map commit:
`a613f96e07728257b543e65695dfc5266a5c8a70` (parent
`1c557a4ddc7a03b08059ea2f069f26e6770de3dd`). This section supersedes the
earlier open held-Promise item above without changing that historical record.
No production code changed.

The architecture requires coherent public windows and callback events when
source changes overlap ordered work. It does not prescribe synchronous timing
for a full-source fallback started after first publication. The finite grammar
adds four histories: deletion or retargeting of marker 1, each with pending or
settled child demand. The fallback applies root 3 and returns a Promise that
remains pending while marker 2 retargets from root 3 to root 2. The independent
join model predicts root 3 after the first marker action and root 2 after the
second. A coherent root-3 window may publish before marker 2 changes; it may
remain visible while the later change is pending. The oracle does not require
or forbid either schedule.

The driver confirms that root 3 applied, the provider Promise remains pending,
and the root Collection reports a pending subset at the overlap cut. It reads
the public window before and after marker 2 changes, then compares the final
window with the model. It replays every public change callback against that
callback's visible rows. If root 3 published before the overlap, its insert
and later delete are expected; an insert first published after the overlap is
rejected. The provider request still has no predicate, cursor, order, limit,
or offset. A synthetic wrong-result control adds a coherent stale root-3
publication and retraction after the correct root-2 result, leaving final rows
unchanged. The event comparison rejects that control.

After the commit hook, the full ordered-lifecycle file passed 292/292 tests
with no Vitest type errors; Prettier and `git diff --check` passed. ESLint had
no errors and one warning on an unchanged line. A temporary loader mutant
that replaced `settlesAsync ? result : Promise.resolve()` with
`Promise.resolve()` survived all four new histories. This is a **survival**,
not a kill: all provider writes in this fixture had already applied, and the
source Collection still tracked the provider Promise, so these public cuts did
not distinguish early loader completion. The mutant was removed. The new
witness protects overlap publication and events, but it does not establish
that the loader waits for provider settlement before claiming full-source
authority when later provider writes or rejection are possible. That separate
ordered-acquisition limit is retained in the coverage map.

| Requirement | Outcome for this follow-up |
| --- | --- |
| ORC-001 | Atomic ordered publication and the absence of a later synchronous cut come from `ARCHITECTURE.md`; the four controlled histories and remaining settlement limit are explicit. |
| ORC-002 | The finite marker-to-root join and null-last sort compute the expected winner without the loader's request or completion classifier. |
| ORC-003 | Opening and local prose distinguish the contract, marker grammar, independent join model, live Collection path, public cuts, and comparison. |
| ORC-004 | No new generated-history claim. The fixed two-marker-action × two-child-state grammar reaches all four cells; root-source changes and later provider writes are excluded. |
| ORC-005 | The real `createLiveQueryCollection`/`preload` path records unfiltered fallback requests, applied root 3, a pending provider Promise, public rows, and callback snapshots at named cuts. |
| ORC-006 | The coherent stale-event wrong-result control is rejected at the event comparison. The separate early-loader-completion mutant survived and narrows the claim as stated above. |
| ORC-007 | No new important generated property; existing fixed and random lifecycle campaigns are unchanged. |
| ORC-008 | The finite model adds a second marker state because the next legal marker action changes the winning root from 3 to 2; it adds no loader state. |
| ORC-009 | Marker mutation, applied source row, provider settlement, public window, and callback publication retain the glossary's separate boundaries. |
| ORC-010 | The provider gate resolves before cleanup even after a primary failure; the existing cleanup helper preserves secondary diagnostics. |
| ORC-011 | No plausible shared semantic fault needing a different join formulation was identified for these three fixed roots. |
| ORC-012 | This exact-commit record gives the observed reach, wrong-result rejection, mutant survivor, and remaining owner limit. |
| ORC-013 | The claim is limited to four named histories and their nearby stale-event control, not a universal provider-settlement boundary law. |
| ORC-014 | The provider is controlled; the test makes no new real-adapter or framework-render claim. |
