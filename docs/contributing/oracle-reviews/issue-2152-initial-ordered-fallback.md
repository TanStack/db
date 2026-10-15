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
