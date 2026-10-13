# Comparison unit retirement: non-finite default order

The source-isolated Field Lab loss audit compared `comparison.test.ts` with
`comparison-oracle.property.test.ts` at frozen head
`f6857fee9de59dc82cbe596ca7df4a18152004ed`. The receiving grammar used
finite numbers and valid Dates; it had no NaN input, invalid Date input, or
`defaultComparator` sort observation. This ledger freezes the five relevant
legacy blocks before retirement. The other five tests in that file have
separate Temporal, symbol, and `compareValues` obligations and remain.

| Legacy block | Source assertion at the function-return or sort checkpoint | Loss in frozen receiver | Receiving check |
| --- | --- | --- | --- |
| `orders NaN greater than every number` | `ascComparator(NaN, 5)` is positive and the reverse negative under `DEFAULT_COMPARE_OPTIONS`. | NaN input excluded. | Tagged numeric finite/non-finite pairs compare signs in both directions. |
| `treats NaN as equal to NaN` | Direct comparator returns zero. | Reflexivity grammar excludes NaN. | Duplicate tagged NaNs compare as one order position. |
| `produces a stable total order with NaN sorting last` | Sorting `[3, NaN, 1, 5, NaN]` with `defaultComparator` yields finite prefix `[1,3,5]` and two NaNs at the end. | No default-sort production path. | The fixed tagged history reproduces these values; a stable source-rank sort predicts every output row ID. |
| `keeps null before non-null values regardless of NaN` | Sorting `[5, NaN, null, 1]` yields null, 1, 5, NaN. | Null and finite signs were separate from NaN/default-sort behavior. | The fixed tagged history combines null and NaN, and the generated grammar varies null presence. |
| `orders an invalid Date greater than valid Dates` | Direct comparator orders invalid Date after `2023-01-01` in both directions. | Date grammar excludes invalid Dates. | A fixed date history uses that day; generated valid epoch-day Dates and invalid Dates compare both ways and in sorted arrays. |

The changelog entry for #1582 promises PostgreSQL-style NaN ordering and
applies it to invalid Dates, with null placement independent of it. The
`DEFAULT_COMPARE_OPTIONS` constant and `defaultComparator` document the
default ascending, nulls-first path. The model receives explicit tags for
null, finite, and non-finite input values and compares rank and finite epoch
day; it does not call the production unorderable classifier to predict a sign.
Direct `ascComparator` returns and `defaultComparator` sort row IDs are the
observations. The comparison occurs at each function return and after sorting.

The bounded grammar uses 1–5 distinct finite numbers or valid Dates in
epoch-day range -20,000..20,000, one or two NaNs/invalid Dates, and optional
null. Fixed histories preserve the old examples. Mixed number/Date order,
Temporal values, symbols, other option sets, and public query/index paths are
outside this transfer. A separate direct `compareValues` behavior remains in
the old file because it has a different production entry point and fallback
law.

## Review and execution

The five listed blocks were removed. The receiving oracle and remaining legacy
file passed with 102 tests (including one Vitest-selected integration file),
and Vitest reported no type errors. Both the fixed seed and seedless campaigns
run the same 100-case tagged property. Its direct replay at property 23,
seed 20260911, path 0 passed. The direct comparator control ties a
non-finite value to a finite value and fails the sign comparison in both
number and Date families. A separate wrong-sort control ties NaN during
`defaultComparator` sort and fails the exact output-row-ID comparison.

The fresh hostile reviewer `/root/review_nonfinite_round5` read the complete
source file, ledger, owner, production comparator, public authority, and
coverage map. It found one exact-assertion loss: Vitest `toBe(0)` on NaN/NaN
rejects negative zero, while the initial sign-only checker did not. The
revised oracle checks the raw result with `toBe(0)` for every non-finite pair;
the reviewer rechecked that change and the separate sort control and found no
remaining loss from the five retired blocks. Its challenge of the broader
Date law found a separate public cross-realm bug. That has its own RED witness
and review record in `cross-realm-date-order.md`; it does not make the retired
same-realm examples unique.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Changelog #1582 and the live-query guide promise NaN/invalid-Date order; `DEFAULT_COMPARE_OPTIONS` and `defaultComparator` establish the tested default path. This transfer claims number-only and Date-only same-realm sorts with optional null. |
| ORC-002 | Input tags and supplied finite values determine expected signs and sort ranks. The model never imports production classification or comparator output. |
| ORC-003 | Opening and adjacent prose identify the law, tagged model, bounded inputs, comparator and sort drivers, result/sign and ordered-ID observations, and immediate checkpoints. |
| ORC-004 | Fixed inputs reconstruct all five source blocks. Generated families, finite values, duplicate non-finite values, and optional null each distinguish a missing behavior. The stated range is -20,000..20,000 finite epoch days, 1–5 distinct finite inputs, and 1–2 non-finite values. Mixed types and unrelated value classes are excluded. |
| ORC-005 | The production `ascComparator` receives `DEFAULT_COMPARE_OPTIONS`; `defaultComparator` drives an actual stable JavaScript sort. Pair signs, exact zero, and every sorted row ID are compared at return. |
| ORC-006 | Separate wrong-result controls reach and fail the direct-sign and sorted-ID comparisons. |
| ORC-007 | Fixed-seed and seedless lanes use the same property and 100-run budget through the existing direct seed/path replay harness. Property 23 replayed at seed 20260911, path 0. |
| ORC-008 | Not applicable: there is no stateful model. |
| ORC-009 | `category` and `order` are model-only tags, not production storage states. |
| ORC-010 | Existing comparison harness preserves primary checkpoint through shrinking and direct replay; this stateless check owns no cleanup. |
| ORC-011 | No shared production/model semantic fault was named within this bounded same-realm transfer. The cross-realm hostile finding has a separate public-query formulation. |
| ORC-012 | This versioned record contains the source ledger, execution, hostile verdict, limits, and the exact-head recheck below. |
| ORC-013 | Finite versus non-finite and null versus non-finite comparisons, plus the wrong-sort control, distinguish a tie-all or misplaced-nulls rule within the bounded default path. |
| ORC-014 | Not applicable: the direct comparator and JavaScript sort run in the package test host; no controlled external provider is extrapolated. |

## Exact committed-head recheck

At published commit `9a145fba130f27c914a4a1fd4f44c5871a917483`, the fresh
hostile reviewer `/root/exact_review_comparison_round5` found no loss from the
five retired same-realm blocks. It checked the complete source file against the
tagged model, exact comparator zeros, and stable sorted row IDs. The focused
comparison suite passed 102 tests with no type errors.

The reviewer also found a separate bug in the broader cross-realm Date repair.
A native foreign Date with an own `Symbol.toStringTag` escaped the production
Date detector. The new direct and public oracle controls failed against that
published implementation. The repair and its fresh committed-head verdict are
recorded in [the Date order review](cross-realm-date-order.md). This finding
does not restore a unique assertion to any of the five retired blocks.

## Frozen-head hostile recheck and adjacent byte-key sensitivity

At `210651d207eefe9bbc025c780f6259e470225c9e`, the hostile review again
found no lost assertion among the five retired same-realm number/Date blocks.
It reconstructed the ledger operands and the direct comparator and sort
checkpoints. This verdict applies to the frozen commit, not to the later
uncommitted repairs.

Source inspection found a separate sensitivity gap in the comparison owner's
native byte normalization law. Its changed-byte property reached the final
byte, but could miss a wrong implementation that ignored an interior byte.
The working-tree oracle now requires different normalized keys for
`[1, 0, 2]` and `[1, 9, 2]` and runs an independently supplied changed-byte
property at the direct `normalizeValue` return. No hostile mutant was run for
this addition, so the fixed pair and property are sensitivity evidence, not
an exact-commit kill. The [Temporal transfer](comparison-unit-retirement-round-6.md)
and [alias owner](temporal-equality-alias.md) record their separate domains.

Review of committed head `d974d4a4f` found that the changed-byte generator
reached only lengths 1–50 while the owner's bounded key-size claim reached
200. The follow-up expands independently supplied changed-byte pairs to
lengths 1–200 for both direct `areValuesEqual` and `normalizeValue` checks.
A fixed 129-byte pair differs only at byte 64. A first-64-byte comparison
fault fails the equality check at the intended direct return; the real
normalizer returns distinct keys. The focused comparison owner passed 117
tests, and explicit test TypeScript, ESLint, and Prettier checks passed. This
is bounded sensitivity evidence, not a claim that every byte sequence or
all binary consumers were exercised. Final exact-commit hostile review of
the follow-up is pending.
