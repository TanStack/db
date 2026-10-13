# `inArray` constant-list Set oracle review

Reviewed source head: the commit that adds this record on `perf-in-set`. The
production change is `18ea072b5`. This record adds the audit only.

## Contract and evidence

The original review called `inArray(value, list)` SQL `IN` under three-valued
logic. That wording is superseded for null-containing lists by the
[compiled `in` contract review](temporal-equality-alias.md#review-of-committed-head-5df06de2e)
and its coverage-map entry. The current evaluator treats a non-null value
against a null-only list as FALSE; SQL would yield UNKNOWN. This is an open
product-law decision, not a claim that the current rule is SQL-equivalent.
The normalization details below describe the reviewed `perf-in-set` head;
the linked review records later Temporal equality changes.

Under the reviewed evaluator rule, a null or undefined value is UNKNOWN
(`null`). A list that is not an array is FALSE. The
result is TRUE when some non-null list item equals the value under the
evaluator's equality, and FALSE otherwise.

The authority is the evaluator contract in
`packages/db/src/query/compiler/evaluators.ts`: `valuesEqual` treats `NaN` and
an invalid Date as equal to each other and to nothing else.
`normalizeEqualityOperand` compares a valid Date as its millisecond timestamp,
compares byte arrays by content, and compares Temporal values by kind and
string. Every other pair compares with `===`. The existing `in` tests in
`evaluators-oracle.test.ts` and the WHERE publication oracle state the same
rules for `eq`.

The change keeps this result and changes its cost. Join demand
(`packages/db/src/query/live/subset-demand-controller.ts`, `createSegment`)
sends one constant `inArray` list. Before the change, each row was compared
with every item, so a cold join over 10,000 rows with no source index took
about 1.1 s. Now a constant list becomes a Set of normalized keys. Byte arrays
stay out of the Set and keep their content comparison.

The oracle is
`packages/db/tests/query/compiler/in-evaluator-oracle.property.test.ts`. Its
model, `referenceIn`, walks the list and applies `referenceEqual`, which
restates the rules above without importing any production comparison or
normalization helper.

## Findings during the review

- **A Buffer from another realm.** The first version of `referenceEqual`
  checked bytes with `instanceof Uint8Array`. Under jsdom, Node's `Buffer` comes
  from another realm, so that check returned false for a Buffer, and the
  reference called a Buffer and an equal `Uint8Array` unequal. Production was
  correct. The reference now checks `ArrayBuffer.isView` and the
  `[object Uint8Array]` tag.
- **The byte-array work law.** The first version of the fix put every list item
  in the Set through `normalizeValue`, and looked up each row value the same
  way. `normalizeValue` encodes a byte array as a string, one character per
  byte. The existing law in
  `packages/db/tests/query/compiler/binary-equality-work.test.ts` (`compares
  <n> bytes with 'in'/... without encoding strings`) counts calls to
  `String.fromCharCode` during evaluation. All 24 of its `in` cases with 129
  or 65,536 bytes failed, and so did `compares a MiB using in without caching
  mutable bytes`. The
  fixed version compares a byte value only with the byte items in the list, by
  content, and does not encode it.

## Mutant results

The production source was restored after each run.

| Mutant | Outcome |
| --- | --- |
| The Set holds raw items, not normalized keys | Assertion failure: 4 of 11 tests. |
| The row value is not normalized before the lookup | Assertion failure: 2 of 11 tests. |
| A byte value compares with byte items by reference | Assertion failure: 3 of 11 tests. |
| A byte value is looked up in the Set | Assertion failure: 3 of 11 tests. |
| Byte items are also put in the Set | Equivalent within the tested domain. A byte value never reaches the Set, so no result changes. The only difference is encoding at compile time, which the work law does not count: it passed 76 of 76. |
| (First fix) every value goes through `normalizeValue` | Caught by the byte-array work law: 25 failures. The `in` oracle passed, because the results were correct. |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. The claim is limited to the boolean result of `in`. WHERE publication, indexes and subset loading have other owners, which the oracle prose names. |
| ORC-002 | Applicable. `referenceIn` and `referenceEqual` are a linear walk over the stated rules. They do not import `valuesEqual`, `normalizeValue`, `isUint8Array` or any other production helper. |
| ORC-003 | Applicable. The opening prose states the contract, the model, the value domain, the production driver, the checkpoint and the limits. |
| ORC-004 | Applicable. The domain is a fixed pool of 25 values that holds the boundary of each rule. Lists have zero to six items and may repeat items. The list comes from a constant or from a row field. Pinned cases reconstruct each boundary: a Date and its timestamp, `NaN` and an invalid Date, `-0` and `0`, a BigInt and a Number, equal bytes, bytes and their internal key, a structural copy, and an empty list. The calibration test removes normalization, and the checker rejects it. |
| ORC-005 | Applicable. The driver compiles the public `in` IR with `compileExpression` and evaluates it per row, as a WHERE clause does. It evaluates one other row first, so a cached list that should not be reused is also checked. |
| ORC-006 | Applicable. The calibration test and the mutants above reach the comparison and fail with an assertion. Each outcome is classified in the table. |
| ORC-007 | Applicable. The same property and budget run twice: once with fixed seed `0x2029`, and once with an unseeded or replay seed through `oraclePropertyOptions`. The property is registered as `evaluators.in`, so `TANSTACK_DB_ORACLE_SEED`, `TANSTACK_DB_ORACLE_PATH` and `TANSTACK_DB_ORACLE_PROPERTY` replay a reported failure directly. The property does not use `fc.commands`. |
| ORC-008 | Inapplicable. The model is a stateless function of the value and the list. |
| ORC-009 | Applicable. The terms match production: "UNKNOWN" is the `null` result, and "normalized key" is the value that `normalizeValue` returns. |
| ORC-010 | Applicable. The check throws one error that names the expected and actual results and the case. It has no cleanup step, so no cleanup error can replace it. fast-check reports the shrunk counterexample with its seed and path. |
| ORC-011 | Applicable and satisfied. The byte-array work law is a second, different formulation. It measures the work of `in` and not its result, and it caught the first fix that the result oracle accepted. |
| ORC-013 | Inapplicable. The oracle protects no threshold or range law. |
| ORC-014 | Inapplicable. No controlled provider supplies a premise. |

## Performance evidence

The repo benchmark (`scripts/bench/incremental-update.ts`) ran three
interleaved times on `main` and on the branch. These are median cold hydrate
times with no source index:

| Query, 10,000 rows | `main` | Branch |
| --- | --- | --- |
| list + author | 1,101–1,221 ms | 79–87 ms |
| list + comment count | 1,024–1,102 ms | 99–112 ms |
| list + 3 recent comments | 1,004–1,019 ms | 91–94 ms |

Median write times did not change beyond noise. Two of the three comparisons
were 1.00× and 0.98×, and a same-code comparison was 0.96×.

## Frozen-head reference-model correction

The hostile review of `210651d207eefe9bbc025c780f6259e470225c9e`
found a false-green risk in `referenceEqual`: realm-local `instanceof Date`
could classify a native foreign Date as an ordinary reference even when the
compiled evaluator correctly compared its timestamp. The working-tree model
now reads a captured native `Date.prototype.getTime`, uses valid and invalid
foreign Dates, and rejects a local object made with
`Object.create(Date.prototype)`. Fixed witnesses check compiled `eq`, constant-list `in`, and
row-supplied `in` in both operand directions. This was a reference-model gap,
not an observed production defect. The focused receiving run passed 72 tests.

The transport controls for equal native Uint8Arrays from different realms
now expect `[true, true]` for the compiled equality paths; request-identity
assertions remain in place. This corrects old test expectations rather than
altering the native byte-content law. The open null-containing-list authority
question recorded by the [Temporal alias review](temporal-equality-alias.md)
is unchanged. The working-tree changes still need a fresh committed-head
hostile review.

The review of committed head `d974d4a4f` found that the positive foreign-Date
controls came from one VM context, while a second context supplied only a
different timestamp. The receiving oracle now requires that second context's
Date to equal its own timestamp through compiled `eq`, constant-list `in`, and
row-supplied `in`. The focused `in` owner passed after this addition. This
checks the compiled equality return for two VM contexts; browser iframe
behavior and a fresh exact-commit hostile review of the follow-up remain open.

## Own-method membership gap at `d917ba4c9`

The compiled `in` evaluator and its reference both called the caller array's
overridable `some` method. A compiled `[1]` with an own `some` returning false
rejected present member `1`; after the list changed to `[2]`, an own `some`
returning true accepted absent member `1`. Constant and row-supplied lists
were both false green. The reference now walks present integer indices through
the length captured at evaluation, independently of the array's methods.
Production calls the native Array `some` with the current list as receiver.
Both false rejection and false acceptance failed at the compiled return before
the repair; the sparse-hole and nullish controls pass afterward. The focused
`in` owner passed 44 tests. This proves the named array-method boundary at
evaluation, not every possible proxy or mutation during one evaluation.
