# Aggregates over nullish values review

Reviewed product head: `13b21ad28c67801786a5f99226cfd14b5d010960` on
`fix/aggregates-skip-nullish-values`, based on `origin/main` at
`c6a85dc0c0025e98e4f8cac2034c1d137b558fd6`. Sources: issue #2365, which had no
maintainer comment at review time, and an internal review with four lenses
(oracle conformance, behaviour, code weight, the law itself) plus a
completeness pass. It reported 29 findings: 25 reproduced and 4 were refuted.

## Contract and scope

Established: the live queries guide describes `count` as "Count non-null
values". `sum` and `avg` return `Aggregate<number>` for a nullable argument
(`aggregate-value-contracts.test-d.ts`), which rules out `null` for them.

Proposed by #2365 and adopted: a nullish value is not a value for `avg`, `min`
and `max`, and a group with no value returns `null` from `min` and `max`.

Proposed by this change, against the issue: `sum` and `avg` of a group with no
value stay 0. Nothing but the parent's output picks 0 over `NaN` for `avg`.
**Open maintainer decision.**

`db-ivm` changes on its own terms: `sum` and `avg` leave out a nullish value,
`avg` of no value is 0 instead of `NaN`, and `min` and `max` of no value stay
`undefined`, which `incrementalization-law-oracle` pins in its output types.
The compiler turns that `undefined` into the public `null`.

## Bug-class boundary

| Path | Evidence |
| --- | --- |
| Grouped and single-group select | aggregate select oracle |
| Aggregates inside `add` and `caseWhen` | aggregate select oracle |
| HAVING over a numeric nullable aggregate | aggregate select oracle |
| `orderBy` over a numeric nullable aggregate, `null` first | aggregate select oracle |
| Includes, per route | aggregate select oracle |
| Union source | aggregate select oracle |
| `db-ivm` `avg` directly | incrementalization law oracle |
| Result types | `aggregate-value-contracts.test-d.ts` |

Original witness: #2365's values 100, 200 and `null`. Adjacent witnesses: a
maximum below zero and a minimum above zero beside a nullish entry, and a Date,
string or bigint column that holds only nullish entries, where reading 0 returns
a value outside the column's domain.

Open cells: joins and optimistic writes over nullable columns are not
generated. A left-joined column keeps a non-nullable `min` and `max` type while
the runtime returns `null` for a group with no match; `ExtractType` drops the
nullable brand, and the parent's 0 hid this. Owner: the aggregate select oracle
and `aggregate-value-contracts`.

No real-host witness is claimed: aggregates are not pushed down to adapters
(`expression-helpers.ts`), and the source is a controlled mock.

## Order of work

The law was first written as a separate oracle, which failed on the parent
before any production edit. Review found that the aggregate select oracle can
express it, so the law moved there and the separate file was removed. The moved
oracle was then run against the parent's production files for the RED below,
after production edits already existed in the working tree. The `db-ivm` law and
the `min` and `max` type came from the same review.

## Evidence

RED, parent production files, `pnpm exec vitest --run --coverage.enabled=false
tests/query/aggregate-select-oracle.property.test.ts`: both campaigns fail, for
example `initial: kids of issue 1: expected [ { f0: 1.5 } ] to deeply equal
[ { f0: 3 } ]`. In `packages/db-ivm`, the incrementalization law oracle fails
with `groupBy mean over nullish values: output delta diverged at checkpoint 0`.

GREEN at the reviewed head: root `pnpm test` passes in every package. The
aggregate select oracle passed 15 of 15 consecutive runs of its unseeded
campaign.

Reach of the generated campaign, seed 2094 and one unseeded run: a group mixes
values with nullish entries 48 and 53; holds only nullish entries 31 and 41; a
maximum below zero beside a nullish entry 20 and 21; a minimum above zero beside
one 21 and 20; a Date column mixes values with nullish entries 44 and 51; holds
only nullish entries 39 and 47; a value replaced by a nullish one 42 and 31; a
nullish value replaced by a value 39 and 37.

Mutants, each rejected by an assertion failure at the intended comparison:

| Mutant | Rejected by |
| --- | --- |
| A nullish value reads as 0 (the original defect) | aggregate select oracle |
| `avg` divides by the row count | both oracles |
| A group with no value publishes `undefined` from `min` | aggregate select oracle |
| `avg` of no value is `NaN` | both oracles |
| `db-ivm` `avg` counts `null` as a value | incrementalization law oracle |
| Only `min` and `max` read a nullish value as 0 | aggregate select oracle |

Weight: production `app` scenario 0 bytes; `app-group-by` +21 gzip and -85
brotli. Tests add 267 lines and remove 46.

## ORC requirements

| ID | Outcome |
| --- | --- |
| ORC-001 | The header names the law, its authority and the open `avg` decision. |
| ORC-002 | `nullableAggregate` uses array arithmetic and imports no production aggregate. |
| ORC-003 | The law and each model rule are in prose beside the code. |
| ORC-004 | Range: numbers below and above zero, Dates, strings, bigints, `null`, `undefined`. Rejected nearby input: Dates, strings and bigints stay out of arithmetic and ordering, which have no stated law for them. |
| ORC-005 | The public `createLiveQueryCollection`, compared after preload and after each step. |
| ORC-006 | The mutants above. |
| ORC-007 | The owner's existing fixed and unseeded campaigns and replay registration are unchanged. |
| ORC-008 | Not applicable: stateless recomputation. |
| ORC-009 | No concept differs from the glossary. |
| ORC-010 | The owner's existing failure handling is unchanged. |
| ORC-011 | Not applicable: no shared-fault hypothesis was named. |
| ORC-012 | This record. |
| ORC-013 | The maximum below zero and minimum above zero states distinguish the law from reading a nullish value as 0. |
| ORC-014 | Claim limited to the controlled mock source. |
| ORC-015 | The reach above, enforced by `createOracleReach`. |
| ORC-016 | No example-based test was added to an oracle file. |

## Follow-up from PR review

Reviewed change: the commit on top of
`b52b0f86083357492ebbf7d36fa4feccc0a3515c` that adds this section. It answers
CodeRabbit's two comments on the PR. It changes the `min` and `max` result
types, their type test, the docs and helpers inside the aggregate select oracle.
Emitted JS for `functions.ts` and `types.ts` is unchanged, so the runtime
evidence above still holds, and seed 2094 reaches the same 48, 31, 20, 21, 44,
39, 42 and 39.

`min` and `max` now return `T | null` for an optional field and for a column on
the nullable side of a join, including a right or full join. A required column
stays `T`, and a generic helper over a required value is not widened.

RED, the reviewed head's `functions.ts` and `types.ts`, `pnpm exec vitest --run
--coverage.enabled=false --typecheck.only
tests/query/aggregate-value-contracts.test-d.ts`: fails at `min` of an optional
field, at the generic `max` helper, and at `min` and `max` of a left-joined
column, for example `Expected null, Actual never`.

Mutants, each rejected in `aggregate-value-contracts.test-d.ts`:

| Mutant | Rejected at |
| --- | --- |
| The new overload ignores the nullable side of a join | `min` and `max` of a left-joined column |
| The new overload ignores an optional field | `min` of an optional field |
| The new overload's result has no `null` | an optional field and a left-joined column |

These are fixed type assertions, not generated inputs.

Open cells at this commit: the left-join gap named above is closed for a column
read directly. `upper`, `lower`, `caseWhen`, and `coalesce` without a non-null
fallback, over a non-nullable column on the nullable side of a join, keep a
non-nullable `min` and `max` type while the runtime returns `null` for a group
with no match. Their return types use `ExtractType`, which drops the nullable
brand, and the parent's 0 hid this.
Owner: the aggregate select oracle and `aggregate-value-contracts`. Joins and
optimistic writes over nullable columns are still not generated.

Correction to the ORC-004 row: the rejected nearby input is `min` and `max` of
Dates, strings and bigints, which the grammar neither adds nor orders. The
reason given in that row is wrong for strings: the oracle orders string fields
under `en-US`.
