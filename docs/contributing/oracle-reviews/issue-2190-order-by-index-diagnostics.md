# Issue 2190: bounded `orderBy` index diagnostics

Date: 2026-10-16

Baseline: `2c83fdc53bd762fa8b8d5e5a8b82e092710618be` (`origin/main`)

Review scope: the repair recorded by this document. PR 2193 was explicitly
excluded from the investigation. This record reviews the issue report against
the baseline and the executable repair in the same commit as this file.

## Law

When a bounded `orderBy` cannot use an installed index for its ordered source
prefix, its development warning must describe the remaining cause:

- no index matches the ordered field;
- field indexes exist, but none matches the resolved comparison options; or
- an index matches both, but cannot support ordered lazy loading.

If any candidate matches the field and comparison options and supports ordered
lazy loading, registration order must not hide it. The compiler must use that
candidate and issue a bounded ordered acquisition rather than a full-source
fallback.

The authority is the existing developer warning's stated remediation and the
bounded ordered-acquisition contract. A diagnostic that recommends work the
Collection already has is false. Index registration order is physical planning
and cannot change eligibility.

## Experiment and inference

`packages/db/tests/index-suggestion-oracle.test.ts` now contains an independent
finite classifier over field identity, null placement, ordered-read capability,
and candidate order. The production driver compiles and preloads a public
live-query Collection and records the development warning.

On the baseline, four of eight diagnostic cells failed:

- a null-placement mismatch emitted the generic missing-index warning;
- matching but order-ineligible indexes emitted the same warning in two cells;
- an ineligible candidate registered before an eligible candidate still caused
  fallback and a warning.

These were assertion mismatches at the intended diagnostic checkpoint, not
setup failures or timeouts. The first three cells establish the issue report's
missing classification. The candidate-order cell exposes a sibling selection
bug: `findIndexForField` returned the first field/options match before the
compiler checked ordered-read capability.

`packages/db/tests/query/custom-index-order-selection-oracle.test.ts` supplies
the production-path witness. An on-demand source registers an order-ineligible
custom index before a normal eligible index. After preload, the query must show
the independently sorted two-row prefix, issue a bounded ordered request, and
issue no unbounded full-source request. A boundary probe may accompany that
request. Spies on the two readers calibrate which compiler path produced the
public requests; reader identity is not itself a public product observation.

A hostile first-match mutant that ignores the eligibility predicate failed that
oracle because the eligible index's `takeFromStart` was never called. The same
mutant also failed two diagnostic cells by silently treating an ineligible
index as usable. These were assertion failures at the intended reader and
warning observations.

An independent prep review then found that the first formatter called
`JSON.stringify` on user-owned comparison options. Both a missing-index and a
mismatch history threw on cyclic `localeOptions`, although `Intl` accepts that
object. A custom comparator was rendered as the unusable string `"[function]"`.
All three added oracle cells were RED on that formatter. The repair describes
only safe scalar fields and tells locale and custom callers to reuse the same
locale configuration or comparator function reference; it does not traverse
those values.

The repaired tree passes all 22 index-suggestion cases and all five custom-index
selection cases. The production-message census also accepts the new
development-only literals.

## Finding ledger

| ID | Source claim | Baseline evidence | Disposition | Durable destination |
| --- | --- | --- | --- | --- |
| I-01 | A same-field index with different `compareOptions` is reported as missing. | The null-placement mismatch cell emitted the missing-field warning. | `fixed-now` | The diagnostic decision table distinguishes field presence from comparison compatibility. |
| I-02 | Full-source fallback is correct when no installed index has compatible ordering. | The incompatible index is rejected and the live-query rows remain correct through fallback. | `fixed-now` | The mismatch and order-ineligible cells preserve both fallback and its reason. |
| I-03 | Suggesting the same `createIndex((row) => row.name)` call is misleading. | The baseline warning repeated the already-satisfied field-only remedy. | `fixed-now` | The mismatch warning supplies a compatible `compareOptions` example. |
| I-04 | The warning should identify a `compareOptions` mismatch. | The baseline used one generic missing-index branch after selection failed. | `fixed-now` | The finite classifier and public warning assertion preserve this distinction. |
| I-05 | The warning should show the options accepted by `createIndex`. | The baseline omitted the query's resolved options and the nested `options.compareOptions` shape. | `fixed-now` | The message fixture and assertions preserve the resolved options and `BasicIndex` example. |
| S-01 | A first matching but order-ineligible index can hide a later eligible index. | The baseline warned and fell back when the custom index was registered first. | `fixed-now` | Both candidate orders are classified; the production-path witness requires bounded demand without an unbounded full-source request and calibrates the eligible reader. |
| R-01 | Formatting a development warning can throw on valid cyclic `localeOptions`. | Query construction threw in both missing-index and mismatch cells. | `fixed-now` | The diagnostic oracle crosses both causes without traversing the options object. |
| R-02 | Rendering a custom comparator as `"[function]"` produces invalid remediation and loses required reference identity. | The warning embedded the string in an executable-looking `createIndex` example. | `fixed-now` | The custom-collation cell requires the exact reference-identity instruction and rejects the old placeholder. |

## Oracle review

- **ORC-001:** The law and limits are stated above and beside both executable
  owners. The comparison-options diagnostic grammar currently distinguishes
  null placement; `BaseIndex.matchesCompareOptions` has separate direct coverage
  for locale, locale options, string-sort mode, direction, and custom comparator
  identity.
- **ORC-002:** The diagnostic model uses only declared candidate facts. It does
  not call the production field, comparison, or eligibility classifiers. The
  ordered-result model sorts a copied row array by numeric rank.
- **ORC-003:** Both owners state their laws, finite histories, production paths,
  observation cuts, and limits beside the executable checks.
- **ORC-004:** Not applicable because the diagnostic grammar is bounded
  enumeration, not a generated-history claim. The matrix still reconstructs
  the report, isolates each classifier axis, crosses both orders for mixed
  eligibility, and excludes an unrelated-field index from field presence.
- **ORC-005:** Public live-query construction and preload reach the warning and
  acquisition paths. The recorders retain every warning and require the exact
  bounded request shape. Reader spies are path calibration only.
- **ORC-006:** The baseline is the rejected generic-diagnostic design. The
  first-match mutant is the rejected one-trace selection repair.
- **ORC-007:** Not applicable; neither new check is an important generated
  property.
- **ORC-008:** Not applicable; both models are stateless finite judgments.
- **ORC-009:** The tests use Collection, source Collection, acquisition, and
  checkpoint as defined by the project glossary. Candidate is a test-only index
  description, not a production lifecycle concept.
- **ORC-010:** Both owners preserve a primary assertion failure separately from
  cleanup failures and restore spies.
- **ORC-011:** Not applicable. No plausible shared semantic classifier was
  identified between the finite model and production. The production-path
  witness supplies integration evidence, not an independent second semantics.
- **ORC-012:** This record supplies the exact RED, hostile-mutant, GREEN, and
  scope evidence for the oracle repair.
- **ORC-013:** Missing-field and mismatch cells distinguish field presence;
  matching-ineligible and matching-eligible cells distinguish capability; the
  mixed-order cells reject first-candidate policy. Cyclic options reject both
  unconditional and mismatch-only JSON serialization, while the custom cell
  rejects remediation that loses comparator identity.
- **ORC-014:** The controlled on-demand adapter proves the compiler-to-adapter
  request and reader choice only. It does not claim real-provider paging.

## Remaining limits

The diagnostic decision table does not enumerate every comparison-option
dimension, every hostile object behavior, production-build suppression,
repeated warning volume, or every query shape. The formatter does not inspect
user-owned locale-options or comparator values, so cyclic objects and function
identity distinguish the unsafe designs without claiming every object shape.
The existing comparison-option tests own the lower-level matching semantics,
and the production-message oracle owns development-text erasure.
Provider paging from an incomplete source and later source changes remain with
the ordered-acquisition owners.
