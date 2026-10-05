# QueryRef publication repair

Pre-repair executable revision: `536708458` on PR #1968.
Repair executable revision: `a5fb460d`.
Guide revision: `a1d75726`.
Earlier verdicts remain at their recorded revisions in the
[portfolio follow-up](2026-09-30-guide-portfolio-followup.md) and
[PR preparation follow-up](2026-09-30-prep-pr-followup.md).

Two public laws were promoted from exact expected-failure guards to ordinary
assertions. Before production edits, the focused run failed two matching
optimizer aggregate cases, one flat aggregate join, and the initial
two-candidate joined `findOne()` case. The nonmatching and rejecting aggregate
controls passed. After the repair, the two owners pass 35 tests with no type
errors.

| Law | Pre-repair gap | Repair and distinguishing witness |
| --- | --- | --- |
| A computed aggregate projection must join by its published value. | `followRef` treated selected `total` as a source Collection field, so lazy acquisition sought a field that the source rows did not contain. A matching global or flat aggregate QueryRef published no joined row. | Computed projections no longer resolve to a source field. The optimizer owner crosses matching/nonmatching totals with absent, accepting, and rejecting outer predicates and retains a separately materialized aggregate control. The QueryRef owner checks the matching flat aggregate at preload, after the count grows, after a new matching person arrives, and after the count shrinks. |
| A `findOne()` QueryRef must reduce to one candidate before its outer join. | `singleResult` changed the receiving result shape but did not limit the nested stream. Two initial joined candidates reached the outer query. | The compiler applies a one-row top-K inside the QueryRef, and lazy acquisition treats `singleResult` as limited. An ordered joined history checks the first, replacement, empty, restored, and changed-join-key cuts. An unordered history checks both QueryRef positions and key-ordered replacement after deletion and reinsertion. A materialized child control checks another receiving boundary. |

The pre-repair failures provide hostile controls against the original wrong
designs. The unordered history additionally rejects an ordered-only repair;
source updates reject a repair that changes only initial publication. These
controlled Collection histories cover the stated finite rows, join shapes,
and synchronous public checkpoints. They do not prove all `singleResult`
forms, join forms, provider schedules, or unbounded histories. The
[coverage map](../oracle-coverage.md) assigns those remaining limits to the
QueryRef and optimizer owners.

At the repair revision, the DB oracle campaign passed 3,712 tests across 55
files with no type errors. The DB build, edited-file lint, formatting, and
documentation link check passed. The full DB suite passed all 7,861 runtime
tests across 225 files, then exited with four type-check errors in the
unchanged `tests/query/subset-error-matrix.test.ts` fixture. Those type errors
are outside the QueryRef owners and are not included in a green full-suite
claim.
