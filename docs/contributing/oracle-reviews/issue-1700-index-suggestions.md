# Collection-size index suggestions: review record

The executable implementation reviewed here is commit `64c79bd8` (parent
`ae2eb3fbf3a314a7f043f0d963fd336d8c1f1ec8`). The raw report is
[issue #1700](https://github.com/TanStack/db/issues/1700), including its
non-blocking performance aside; it had no comments at evaluation time.

## Law, reach, and observations

`IndexDevModeConfig.collectionSizeThreshold` documents size-based index
suggestions, and the emitted message asks a developer to add a field index.
For a queried source Collection over the threshold, advice is useful when the
field is not indexed and the Collection does not create an index itself. It is
redundant when `autoIndex: 'eager'` creates the matching index.

The bounded oracle in `packages/db/tests/index-suggestion-oracle.test.ts`
uses a public filtered live-query Collection at initial readiness. Its model
is the stated size/mode/matching-index rule. The history grammar crosses
explicit manual mode, default manual mode, eager mode, 1,000 versus 1,101
rows, no/matching/unrelated index, and advice enabled/disabled. It checks the
actual suggestion metadata, exact public result row, and index count. The
unrelated-index control rejects a classifier that suppresses advice merely
because some index exists.

On unchanged `ae2eb3fb`, the final oracle was **RED** in four of seven cells:
explicit manual mode, default manual mode, and manual mode with an unrelated
index each recorded zero suggestions where one was expected; eager mode
recorded one where zero was expected. The threshold, matching-index, and
disabled-advice controls passed. On `64c79bd8`, all seven cells passed; the 17
existing auto-index tests passed,
and package Vitest reported zero type errors. The change keeps the production
file at 5 added versus 6 removed lines. The report's proposed single-guard
inversion was insufficient because `ensureIndexForExpression` had its own
manual-mode early return; the fix changes both gates.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Public dev-mode configuration and suggestion message supply the policy; this owner limits itself to initial filtered-query readiness and size advice. |
| ORC-002 | Expected advice follows the declarative size/mode/index rule, without importing production's guard or index-search helper. |
| ORC-003 | Opening prose states the contract, model, grammar, driver, and checkpoint; `expectedSuggestions` and the public query assertions keep them visible. |
| ORC-004 | Not triggered: the seven-cell matrix is bounded enumeration, not a generated-history coverage claim. |
| ORC-005 | `createLiveQueryCollection` executes the reported WHERE path; the test checks public rows and captured `IndexSuggestion` metadata after readiness. |
| ORC-006 | The actual pre-fix implementation fails at both intended advice assertions, demonstrating checker sensitivity. |
| ORC-007 | Not triggered: no important generated property was added. |
| ORC-008 | Not triggered: the model has no evolving reference state. |
| ORC-009 | Not triggered: the model uses the Collection, row, index, and readiness concepts directly, with no combined lifecycle abstraction. |
| ORC-010 | The fixed matrix does not shrink or capture asynchronous failures. Each fixture cleans up both Collections and reports assertion plus cleanup failures together, preserving the assertion as the cause. |
| ORC-011 | No named plausible fault shared by production and this independent declarative advice rule requires a second formulation. |
| ORC-012 | This record names the reviewed commit, RED/GREEN observations, controls, and limits. The bounded closure is manual/default/eager × initial filtered-query setup × public suggestion/index/result observations. It does not claim all query shapes, repeated warning volume, post-GC histories, slow-query timing, index work, or production-build execution. |

The coverage map names the owner and remaining limits. The report's post-GC
repetition was not separately executed; the fixed eager branch cannot emit a
size suggestion regardless of whether cleanup cleared an index first. The
report's timing figures remain background context, not a verified work law.
