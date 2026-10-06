# Mixed-demand recovery review

Evaluated source: `b407d29015d2e5a611149001bf66f79c0df3cd68`, PR #2039.
The resumed medium review supplied one behavioral concern, a documentation and
coverage caveat, five positive assessments, a review-scope caveat, and its
execution limitation. All nine entries are retained below. Production is unchanged.

## Verdict and reviewer assessment

The reported Collection-wide failure is real. M7's recorded implementation
contract explicitly sends invalid retained native demand through the existing
terminal error path during fallback sequence-gap recovery. Valid demands after
that failure do not continue in the failed sync run. The stream does not advance
through the failed recovery; later messages are fenced rather than repeatedly
replaying the same gap. Per-demand isolation would change this contract.

The prior HE-001 label, “refuted as a recovery/liveness defect,” was too broad.
Its repeated-gap consequence was refuted; the terminal failure and stopped
suffix were observed and preserved deliberately. This record corrects that
wording without claiming a production repair.

Hire for scoped review with verification support. The reviewer correctly follows
the error through the outer terminal boundary, lowers severity, and flags the
policy ambiguity. Its “no oracle” statement misses the existing single-demand
witness and the earlier two-order scratch probe. The useful new distinction is
that the mixed-demand law was not retained in the permanent owner. No tests were
run by the reviewer, and its positive findings are bounded evidence rather than
proof over every legal input.

## Finding ledger

| ID     | Claim                                                                                                                                                                                                                            | Technical verdict and evidence                                                                                                                                                                                                                                                                                    | Action and durable value                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| MR-001 | A local leader admits native demand, becomes a follower, and a gap recovery stops on that demand; later valid demands are not queued, position does not advance, and the Collection fails. Same earlier finding remains unfixed. | Accurate behavior in fallback recovery. M7 and the existing terminal coordinator boundary select it. Both native kinds and both demand orders reach it. Later deliveries and loads are fenced by the exact original error. “Unfixed” misclassifies the retained policy.                                           | Duplicate of the existing M7/HE-001 boundary, with the prior overbroad refutation corrected. No catch-and-continue production change. |
| MR-002 | “Reports a collection error” understates terminal failure; no oracle covers the lost siblings.                                                                                                                                   | Partly correct. The existing singleton oracle tests terminal failure, and the prior scratch probe tested both orders. The permanent owner omitted mixed-demand dispatch coverage, reentrant sibling error identity, and the post-terminal suffix. Both calibrated wrong implementations passed the old selection. | Fixed now: extend the existing persisted oracle and clarify the guide. No new owner or lifecycle.                                     |
| MR-003 | Removed hydration ensure duplicated the direct ensure; no await between post-wait validation and routing.                                                                                                                        | Source confirms the removed dispatch duplication. Existing entry/post-hydration admission witnesses and original-guard controls remain applicable. The gap in MR-002 is another path.                                                                                                                             | Already fixed in earlier work; preserve exactly-once direct-dispatch controls and role-transition admission.                          |
| MR-004 | Validation-only mode does not mutate input and preserves the projection traversal's caching. Repeated discarded projections were fixed.                                                                                          | Confirmed within the existing law audit: accepted/rejected rich input observations, detached aliased snapshots, reached Date-mutation and shared-Date controls, and 18 original-guard copy-budget failures. Separate validation traversals remain.                                                                | Already fixed. Do not convert bounded copy observations into total-allocation or latency claims.                                      |
| MR-005 | Temporal fixed-width keys order the full ranges; equality matches core including calendars.                                                                                                                                      | Consistent with the codec rule and endpoint/precision/calendar witnesses. Tests sample boundary families; this review is not an exhaustive proof of every representable value.                                                                                                                                    | Duplicate of typed-value and expression-index evidence; retain its explicit host/range limits.                                        |
| MR-006 | SQL placeholders are not duplicated; mixed IN and native range/NOT candidates are supersets; NUL literal construction terminates.                                                                                                | Consistent with prior receiving SQL, candidate-row, polarity, binding and NUL controls. Those assertions, rather than the review's unexecuted approval, supply evidence.                                                                                                                                          | Duplicate of existing compiler and expression-index law checks.                                                                       |
| MR-007 | Clone retains Date/bigint and native values, changed index SQL rebuilds through DROP, obsolete entries are documented.                                                                                                           | Supported value-domain claims agree with current receiving tests. “Matches old JSON clone” is not universal: preserving native values intentionally changes JSON's lossy behavior. Old/new registry and explicit reset histories retain upgrade evidence.                                                         | Duplicate of bounded follow-up and index-value owners. No automatic destructive migration.                                            |
| MR-008 | Other high-review items were not adjudicated; unsupported PlainDateTime/ZonedDateTime and matching global constructors merit a higher-effort pass.                                                                               | The review's scope limit is honest. HE-003/004 already reproduce those restrictions and trace them to selected v2 M1. Wrapper request identity itself needs no global constructor. Engine-native Chrome/polyfill interoperability remains an explicitly unclaimed receiving boundary.                             | Duplicate of selected restrictions and existing host evidence limits; no feature expansion or new blanket completeness claim.         |
| MR-009 | The reviewer ran no tests because its worktree lacked node_modules.                                                                                                                                                              | That accurately describes its evidence limitation, not an inability to run current-source checks. Cached dependencies and source aliases execute this checkout without installing or changing dependencies.                                                                                                       | Already fixed as an evaluation evidence gap: local executable checks and calibrated controls below.                                   |

## Law, model, histories and observations

Authority is the existing terminal coordinator-recovery boundary, M7 in
[the v2 model](issue-2034-design/v2-model.md), the glossary's distinction between
abort and acquisition release, and the primary persisted owner's error laws.
The review does not authorize extending the Temporal wire domain or isolating
failed recovery per demand.

The new bounded rule names two independent demands: a candidate and a valid
sibling. Its inputs are candidate kind (Instant, PlainDate, string), insertion
order (candidate first/last), and lifetime (retained, aborted, released). All 18
cells run. The model predicts terminal versus ready state and the permitted
remote-dispatch coverage. Aborted or released candidates cannot trigger wire
admission failure. A retained native candidate terminates recovery. An earlier
valid demand may already be in flight; a later valid sibling is fenced. With
only admissible demand, both retained demands must eventually dispatch.

The model uses those fixture labels and the stated contract, not production
queues or the production validator. Dispatch attempts are recorded in order
with exact request objects. Presence checks judge demand coverage; duplicate
transport attempts are not forbidden by this law. The trace is not presented as
an exactly-once or bounded-work result.

The driver uses the real Collection and persisted wrapper, an ownerless elected
coordinator, and recording persistence. It completes both local loads, applies
abort/release if selected, becomes follower and emits a sequence gap. The
coordinator omits `pullSince`, so this tests fallback reload, not successful
replay-delta recovery. Remote settlement remains held while failure is observed.

Observation cuts are explicit:

1. Before the role change, both local loads complete and remote attempts are empty.
2. While transport is held, recovery reports terminal error for retained native
   demand, or remains ready for controls. The error callback reenters a sibling
   load before core marks the Collection failed; the runtime must already reject
   with the original error object.
3. At admission failure, dispatch coverage contains only the permitted prefix.
   Successful controls check complete coverage after remote settlement, allowing
   serial dispatch.
4. After terminal error, a late transport rejection, two more gap messages, and
   advancement of the controlled retry clock cause no more hydration or remote
   attempts. Another sibling load rejects with the same error; reporting occurs once.
5. Every retained lease can still be released with the exact original object.
   Aborted demand still owns a release; previously released demand is not released twice.

The comparison does not inspect private stream counters. Source reading confirms
that failed recovery returns before stream advancement; the public law checked
here is that no later recovery or load silently continues in the terminal run.
No assertion claims row correctness, real browser elections, arbitrary custom
coordinators, successful pullSince recovery, or native row transport.

## Calibration and verification

Two plausible wrong implementations demonstrate old false greens:

- Recover only the first active demand: all three old singleton cases pass.
  The final expanded checker rejects seven cases at dispatch-coverage or
  Collection-status assertions; eleven distinguishing controls pass.
- Store a newly created terminal error while reporting the original: all three
  old cases pass. The expanded checker rejects all four retained-native/order
  cases at exact-error identity; fourteen controls pass.

Mutants transform source in temporary test configurations; production files were
never edited. These final kills are assertion failures, not setup errors or
timeouts. The first draft incorrectly required full successful dispatch while
transport remained held; two controls rejected that draft on real production.
The corrected successful checkpoint waits for settlement. Initial mutant
receipts also included two timeouts and are excluded from the final calibration.

The final focused owner passes 18/18. The SQLite-core jsdom selection passes 538 tests across 11 files, with one existing TODO and no failures. TypeScript passes. ESLint reports zero errors and 22 existing warnings. Source/report formatting and whitespace checks pass. The final timer observer starts its controlled clock before releasing the late rejection; the focused GREEN and both RED controls were rerun after that ordering improvement. Scratch receipts are temporal-medium-focused-green.json, temporal-medium-core-green.json, temporal-medium-first-only-final-red.json, temporal-medium-error-identity-red.json, temporal-medium-types.log and temporal-medium-eslint.log.

Oracle-guide audit: ORC-001/002 use the existing M7/error/lease contracts and
independent fixture-label rule. ORC-003/005 keep prose, rule, grammar, real driver
and cuts beside the executable tests. ORC-006 uses both reached mutants.
ORC-004/007 generated-campaign requirements do not apply to this fixed exhaustive
18-cell matrix; all axes and their distinguishing observations are stated here.
ORC-008 adds no state machine. ORC-009 retains glossary vocabulary.
ORC-010 preserves primary failure, restores spies/timers and releases held work.
ORC-011 has no named shared semantic classifier: the independent law does not
call production validation. ORC-012 is this record. ORC-013 uses string,
abort/release and both order controls. ORC-014 explicitly limits the controlled
coordinator result; Browser/Electron receiving owners remain separate.

## Loss audit and remaining decisions

Nine entries = one fixed-now coverage/documentation gap, three already-fixed
items, and five duplicates. No new production fix, deferral or design decision
is claimed for this review. The approved Collection-wide terminal policy is
retained. Complete law enforcement is claimed only at the five cuts across the
18 fallback-recovery histories above; receiving-host and wider lifecycle claims
remain bounded as stated.

The separate late-added-handler question from the later CodeRabbit summary
(CR4-002) remains unresolved. This review does not answer it. It neither requires
nor justifies changing recovery policy for ordinary startup-declared handlers.
