# PR #1920 Collection collation oracle review

## Reviewed state and claim

- Base: `33a194941c8d51f8f98babb999fef2987dd6ff8b` (PR merge base).
- Reviewed executable head: `778c542fa06f4a5ff3f469648a6ca265d638ca70`.
- Owner: `packages/db/tests/index-update.property.test.ts`.
- Public entry point: `Collection.currentStateAsChanges({ orderBy })`.

The Collection's declared string collation determines the order of public rows.
The auto-index path must use a compatible index and reuse it across repeated
reads. The scan path must return the same declared order. The fixed owner cells
check lexical and numeric `en-US` defaults, plus an explicit ordinary-locale
clause overriding a numeric default. Indexed cells cross BasicIndex and
BTreeIndex; scan cells use `autoIndex: off`. A six-row scan cell also bounds
comparison-option resolution to at most two reads: one for the attempted index
path and one for the scan clause.

The original implementation failed six indexed cells at the public read and
index-construction checks. Its numeric-locale scan also returned lexical order.
The combined two-line revert at `74a0e0dd` failed 7 of 9 fixed collation
cells, while lexical and explicit ordinary-locale scan cells passed as controls.
The later CodeRabbit follow-up removed repeated option and comparator creation
inside the scan sort callback. Reversing that follow-up failed the six-row work
cell with six Collection option reads against the bound of two. These were
assertion failures at the intended checkpoints, not timeouts or setup failures.

## ORC-001 through ORC-011

| Requirement | Outcome at reviewed executable head |
| --- | --- |
| ORC-001: authority and limits | Pass for the new cells. `defaultStringCollation` is the public Collection declaration, and order clauses can supply explicit comparison options. The opening test prose and coverage map state the row-order and index-reuse law. The coverage map limits this owner to lexical and numeric `en-US` cases, an explicit ordinary-locale override, BasicIndex/BTreeIndex, fixed public reads, and a six-row scan work probe. Other locales and ordered histories are outside this owner. |
| ORC-002: independent judgment | Pass for the new cells. Expected label arrays are literal facts chosen to distinguish lexical from numeric order. The six-row expected array is literal; the option getter count is an observed work measure. None derives its expected result from `buildCompareOptions` or `makeComparator`. |
| ORC-003: visible responsibilities | Pass for the new cells. The opening comment states the law, `collationCases` and the six-row input state the bounded model, `createCollationCollection` supplies the fixture, `currentStateAsChanges` is the production driver, and row/count expectations are the refinement checks. |
| ORC-004: generated-history controls | Not triggered by the new fixed cells; they are a bounded enumeration, not an important generated property. The older direct-index `fcTest.prop` grammars in this same file predate this PR. Their ablation and exclusion evidence has not been audited to this requirement and remains an owner gap. |
| ORC-005: path and observation | Pass for the new cells. `optimizedOnly` plus a `createIndex` spy witnesses indexed reads and one construction; `autoIndex: off` plus zero indexes witnesses the scan path. At Collection readiness, the tests compare exact public row order. The work cell also checks a bounded number of Collection collation reads. |
| ORC-006: checker calibration | Pass within the stated paths. Reverting both original production lines caused 7/9 fixed cells to fail by assertion at public row/order or index-construction checkpoints. Reversing the scan-work follow-up caused six option reads against the allowed two, while row order remained correct. The current code passes both checks. |
| ORC-007: fixed/random campaigns and replay | Not triggered by the new fixed cells. The older important generated direct-index properties are not in the package `test:oracles` command and do not have paired fixed/random campaigns with direct replay; that pre-existing gap remains with this owner. The separate retired-identity replay calibration is a different property. |
| ORC-008: stateful-model minimality | Not applicable: this change adds no state to a reference model. The fixed expected arrays and work bound are stateless. |
| ORC-009: vocabulary mapping | Not applicable: no model-only state or action combines or splits production concepts. `Collection`, row, public read, and index use their project meanings. |
| ORC-010: failure fidelity and cleanup | Unresolved for the fixed cells. They await `Collection.cleanup()` in `finally`; a cleanup rejection could supersede a hard primary assertion. No cleanup-failure run was included, so this record does not claim primary/secondary diagnostic separation. |
| ORC-011: independent second formulation | Not applicable. Review named no plausible semantic fault shared by the literal expected orders and production comparator that another formulation would distinguish. The indexed and scan drivers are separate production paths, not competing reference models. |

This versioned record supplies the ORC-012 outcome for executable head
`778c542fa06f4a5ff3f469648a6ca265d638ca70`. It does not claim that the
older generated properties meet ORC-004 or ORC-007, or that the cleanup harness
meets ORC-010.

## CodeRabbit reconciliation and verification

CodeRabbit reviewed `74a0e0dd` and placed one Trivial nitpick in its review
body, with no inline comments. It correctly identified per-comparison option
and comparator creation in `change-events.ts`. A public six-row scan gave a
deterministic RED count of six Collection collation reads. Hoisting one
comparator per clause gave GREEN with two reads and the same exact public order.
The one work cell failed again when the follow-up was reversed. The review's
AI-agent prompt repeated the same finding. Its large-scan merge-risk sentence
named the same performance cost, not another correctness issue.

The review also noted that failed index construction can consume an index ID
before an index is registered. That behavior predates this PR. The review did
not identify a public failure caused by the collation change, so it remains
outside this follow-up. Its deployment-exposure discussion was explicitly
inferred and did not establish an application security boundary. Its vendor
docstring warning used an 80% threshold that this repository does not configure;
adding boilerplate to these existing functions would not repair a product
contract. No new public API or security operation was added.

At executable head `778c542f`, the five relevant files passed 416 tests.
Package TypeScript, changed-file ESLint, Prettier, and `git diff --check`
passed. Independent prep review and simplification passes found no further
actionable issue. The published PR's original checks were green before this
follow-up; new-head CI must be checked after publication.
