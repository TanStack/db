# NaN ranked-window oracle review

## Reviewed state and claim

Base: `bef12e24`, the freshly fetched `origin/main` used to create this branch.
This record reviews the Git tree that contains it. The final commit or pull
request identifies that immutable tree.

The public live-query guide gives `NaN` PostgreSQL float semantics: it equals
itself and sorts after finite values in ascending order. A descending top-three
window over ranks `10, 20, NaN, 30, 40` therefore exposes keys `[3, 5, 4]`.
The Collection must publish that window without a graph error. This change
repairs equality of copied numeric `NaN` leaves and invalid Date timestamps
inside structural contributor signatures.

The claim covers eager direct-source ordering at initial publication and the
listed rank updates, deletion, and offset move. It does not establish on-demand
NaN rank acquisition, joined-query signatures, null/NaN combinations, or
typed-array NaN equality. The coverage map assigns those public query gaps to
the pagination owner.

## RED and GREEN evidence

On the unchanged base, the primary pagination oracle passed its ascending NaN
and descending finite controls. The descending NaN window and its update
history threw `Query contributors with the same row key are not congruent` in
the real graph at `compiler/index.ts:1282`. These are graph-run failures before
the public row assertion, not wrong-row assertion kills. A separate equality
test returned `false` for copied `{ rank: NaN }` values.

The final fixed lane includes the original five-row case, a three-row shrink,
two NaN values with a public-key tie, ascending and finite controls, a window
move, and equal, changed, restored, and deleted source ranks. The same public
driver and independent full-sort model compare ordered rows after preload and
each action. A wrong-order control sends the correct three members in the wrong
order to the same row comparison and gets an assertion failure.

The initial focused GREEN run passed 314 tests across the pagination and
structural-equality suites. Final verification receipts belong in the pull
request because later edits can change their exact boundary.

## ORC-001 through ORC-012

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | Pass. The live-query guide defines NaN ordering and equality. The pagination oracle and coverage map state the bounded path and omitted cases. |
| ORC-002 Independent judgment | Pass. The model sorts copied source rows with `Number.isNaN`, relational comparison, and numeric public keys. It does not call the production comparator or structural equality helper. |
| ORC-003 Distinguishable responsibilities | Pass. The pagination file states the law, full-sort model, fixed ranks and actions, public Collection driver, and ordered-row checks at preload and action checkpoints. |
| ORC-004 Generated-history controls | Not triggered by this fixed lane. Existing generated integer histories and their grammar are unchanged. |
| ORC-005 Production path and observation | Pass. `createLiveQueryCollection` compiles a real eager `orderBy(..., 'desc').limit(3)` query. The driver reads complete public rows after preload and after each action. The original graph error is also observed. |
| ORC-006 Checker calibration | Pass. The original implementation fails before the row checkpoint and is classified as a graph-run failure. The wrong-order control fails the same row comparison by assertion. |
| ORC-007 Fixed/random replay | Not triggered by the new fixed lane. The existing generated campaigns retain their seed, replay, and budget. |
| ORC-008 Stateful-model minimality | Not triggered. The new lane uses the existing source-row map and stateless full recomputation. It adds no model state. |
| ORC-009 Vocabulary mapping | Pass. Source rows, public rows, window, graph run, and publication follow the project glossary. The model adds no lifecycle abstraction. |
| ORC-010 Failure fidelity and cleanup | Pass. `withHistoryCleanup` releases the source when graph construction fails and preserves a primary failure if cleanup also fails. It releases both Collections after successful construction. |
| ORC-011 Independent second formulation | The literal key vector `[3, 5, 4]` checks the full-sort model. Ascending, finite, and duplicate-NaN cases challenge the rank rule without copying production's comparison code. A separate backend formulation is outside this eager Collection claim. |
| ORC-012 Review evidence | This base-identified record gives each outcome and the bounded claim. The coverage map links it and names the remaining public paths. |

The bounded repair covers the NaN ordering law × the listed eager source-row
histories × direct top-K compilation × public ordered rows after preload or a
source action. It does not claim every legal NaN query history.
