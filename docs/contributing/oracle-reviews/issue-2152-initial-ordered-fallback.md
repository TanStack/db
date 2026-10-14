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
ordered page. The revised oracle starts the sync run, records request shape and
public state immediately, then compares again after settlement. Its two-row
ISO-string reference predicts row 2 for descending `findOne()` without using
the production comparator. The warm null case checks an already installed
source, where the continuation has no new row input to drive another graph
turn.

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

The original `!hasSettledSourceRequest` gate is the calibrated wrong design:
it reaches both acquisitions but fails the immediate comparison, then passes
after settlement. The production repair also excludes ordering repair debt
and an explicit window operation from the synchronous path. Its production
diff is five added and three removed lines, net two; test and contract prose
are accounted for separately.

## ORC-001 through ORC-014

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The authority is the architecture's initial-readiness cut. The owner states that source exhaustion, real-provider behavior, and React render timing are outside the controlled oracle. |
| ORC-002 | Expected ids come from two fixed ISO dates and a descending singleton; synchronous versus Promise readiness comes from the contract. Neither the loader's cursor classifier nor production comparator computes the reference. |
| ORC-003 | Opening and local prose distinguish the law, two-valued reference, four-cell grammar, live Collection driver, immediate and settled observations, and refinement checks. The warm test explains its no-input continuation. |
| ORC-004 | The added grammar is a complete finite index × fallback-settlement matrix, not a new generated-history claim. Its four cells are enumerated, and request offsets establish distinct index paths. The existing generated lifecycle grammar was unchanged. |
| ORC-005 | `createLiveQueryCollection()` and `preload()` execute the real core path. The recorder captures both requests before the immediate public `toArray`/`status` comparison. Adapter writes and `commit()` precede literal `true`; no missing-source-facts hypothesis remains for these fixed cases. |
| ORC-006 | Unchanged production is the wrong-result control. Three assertions fail at the intended immediate checkpoint and pass after the fix. This is an assertion kill, not a timeout or setup failure. |
| ORC-007 | Not triggered by the new finite cells. The owner's pre-existing fixed and random campaigns are unchanged and ran in the broad suite. |
| ORC-008 | No stateful reference-model state was introduced or revised; the new reference is a stateless two-case observation. |
| ORC-009 | “Initial chain” maps to the ordered acquisition plus fallback before first publication. `rows` and `status` are public observations, not model state with a production counterpart. |
| ORC-010 | `finishOracleCleanup` releases live and source Collections while retaining a primary mismatch and separate cleanup errors. The owner's failure-fidelity test remains in the passing broad run; no shrinking is used for the finite cells. |
| ORC-011 | No plausible shared semantic classifier fault requiring a second formulation was identified. A real on-demand provider handoff remains separate and open below. |
| ORC-012 | This record identifies applicable obligations, non-applicable triggers, the exact reviewed code commit, and the bounded bug-class result. |
| ORC-013 | Literal `true` versus Promise separates the synchronous boundary; indexed versus unindexed acquisition and a warm null boundary are adjacent legal witnesses. The old gate fails two string cells and the warm cell at the named cut. |
| ORC-014 | The on-demand adapter's controlled premise is an applied receipt followed by literal `true`. The claim is limited to that boundary. React's eager source provides a separate first-commit receiver, not a real on-demand provider handoff. |

## Bounded result and open handoff

The repair is evidenced for the fixed indexed and unindexed locale-string
`findOne()` histories, a warm null boundary, Promise fallbacks, and an eager
React first layout commit. It does not establish that a real on-demand adapter
can return literal `true` with the same applied-receipt timing. The ordered
acquisition coverage map assigns that receiving witness to ordered acquisition
and the adapter integration. No reachable counterexample remains in the
executed core and React paths at their stated checkpoints.
