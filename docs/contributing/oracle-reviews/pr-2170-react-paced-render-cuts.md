# PR #2170 React paced-mutation render-cut review

Reviewed product commit: `6d176225cdcac2547ec04c7df86c0a5b8bc0c88f`.
Base: `ce0b4a98061e335f7aeb144283c7679d6fdc6529`.
The production repair already existed at the reviewed commit. This follow-up
replaces its example-only tests with an independent React receiving oracle and
updates the coverage map.

## Law and result

`usePacedMutations` exposes callbacks from the latest committed render. A
render that suspends cannot replace the callbacks used by the visible
component. A render that commits publishes its callbacks before descendant
layout effects. The returned mutate function keeps its identity across a
callback-only commit.

The public hook contract supplies immediate optimistic mutation and delayed
persistence. React supplies the render/commit distinction and insertion effects
before descendant layout effects. The model retains only the document owned by
the latest commit. It predicts callback ownership without reading production
refs or effect choice.

The bounded grammar crosses ordinary and StrictMode schedules with five
histories: mutation before a render that stays suspended, mutation after that
suspended render, mutation after the candidate commits, and delayed or
immediate mutation from a descendant layout effect. A committed history first
suspends B and then releases it. A descendant layout call without a commit is
excluded because that descendant does not mount.

The driver renders the public hook, updates a real Collection, and controls the
debounce edge. It compares the ordered optimistic/persistence callback trace
and both public rows at the mutation cut, the trace after persistence, and
mutate identity at the commit cut. No history commits another render between
transaction admission and persistence. Transaction-admission callback affinity
remains a separate contract question.

## Calibration and GREEN

The original render-time ref update failed four of ten histories at the intended
comparisons. Before-render/suspended histories persisted through B's
uncommitted callback. After-render/suspended histories invoked B's optimistic
callback from A's visible button. Each failed in ordinary and StrictMode runs.

A layout-effect-only mutant passed suspended-render isolation but failed both
delayed descendant-layout histories: B's layout call used A's optimistic
callback. A split mutant that published `onMutate` in insertion effect and
`mutationFn` in layout effect passed the delayed histories but failed both
immediate descendant-layout histories at the persistence trace. These mutants
failed by assertion after reaching the named public cut; none failed during
setup or by timeout. The insertion-effect implementation passes all ten
histories. The unchanged core paced owner passes 154 tests while these React
mutants are possible, confirming that it owns a narrower boundary.

## External-review ledger

| ID | Claim | Verdict and action |
| --- | --- | --- |
| ER-001 | An uncommitted render can replace the optimistic callback used by the visible component. | Confirmed by the after-render/suspended histories; fixed by the reviewed product and covered by the React oracle. |
| ER-002 | An uncommitted render can replace the persistence callback for an admitted mutation. | Confirmed by the before-render/suspended histories; fixed and covered. The committed neighbor intentionally selects the newly committed callback. |
| ER-003 | A parent layout effect publishes too late for a descendant layout mutation. | Confirmed by the layout-effect mutant; insertion-effect production and descendant histories cover it. |
| ER-004 | Callback refresh must preserve mutate identity. | Already preserved; retained as a neighboring assertion on every committed history. |
| ER-005 | Eight submitted examples close the reported class. | Refuted as test-integrity evidence. They reproduce faults but have no independent model or hostile timing challenges. Replaced with the bounded oracle. |
| ER-006 | Core paced tests do not exercise React's render/commit boundary. | Confirmed. The core owner remains unchanged; the coverage map now names the React receiving owner. |
| ER-007 | No actionable issue and minimal merge risk. | Refuted as a readiness conclusion because it missed the oracle and coverage gaps. Its implementation summary was accurate. |
| ER-008 | Add docstrings to satisfy the review bot's touched-function ratio. | Refuted. The exported hook is documented; local fixture helpers need literate oracle prose, not individual API docstrings. |

## Oracle guide audit

| Requirement | Result |
| --- | --- |
| ORC-001 | The opening prose states the committed-callback law, authority, and limits. Transaction-admission affinity stays open. |
| ORC-002 | The model tracks only the latest committed document and never reads production refs or effect choice. |
| ORC-003 | Contract, model, bounded grammar, public driver, observations, and checkpoints are distinguishable in the executable file. |
| ORC-004 | No generated property is claimed. The finite grammar reconstructs both reported faults and the layout neighbor; StrictMode supplies the alternate React schedule. |
| ORC-005 | The public hook and real Collection run. Ordered traces retain wrong callback ownership, and assertions run before and after persistence. |
| ORC-006 | The render-time, layout-effect, and split callback-publication mutants fail at their intended comparisons. |
| ORC-007 | Not applicable: this is bounded enumeration, not an important generated property. |
| ORC-008 | The model retains one committed owner because the next callback distinguishes A from B. No other model state is introduced. |
| ORC-009 | `owner` is the document whose committed callback runs. It is not Collection ownership or transaction ownership. |
| ORC-010 | Testing Library cleanup and Collection cleanup run after each history; calibration failures remained the primary assertions. |
| ORC-011 | No shared semantic classifier exists between the one-field model and the React ref implementation. The layout-effect mutant is a second timing challenge. |
| ORC-012 | This revision-bound record captures law, grammar, driver, cuts, mutant outcomes, limits, and the item ledger. |
| ORC-013 | Suspended and committed neighbors distinguish render from commit; immediate descendant persistence distinguishes insertion from layout publication for both callbacks. |
| ORC-014 | Not applicable: the claim stops at the controlled React host and does not assert server or other-framework behavior. |

## Limits and readiness

The evidence closes callback ownership for the ten named React histories. It
does not cover arbitrary transition interleavings, errors, unmount during a
pending write, multiple independently changing callback contexts, server
delivery, or other frameworks. Callback affinity to transaction admission is
an unresolved design question; it does not contradict the explicit latest-
committed-callback contract reviewed here.

All eight raw review items are accounted for: three fixed-now, one already
fixed and retained, one repaired test-integrity gap, one repaired coverage gap,
and two refuted review conclusions. The oracle repair is complete for the named
boundary. Whole-PR readiness still depends on final branch review and CI.
