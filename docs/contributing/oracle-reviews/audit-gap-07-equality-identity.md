# Equality identity oracle review

Reviewed executable commit: `7f8617a474a8fa94c30586869c4695e819ac069b`.
The review checked GAP-07 from the code-weight audit. Its sole claim was a
missing agreement test between D2 equality-value keys and query IR equality
operands. The code review also found that the first generated grammar lacked
unequal Date, Temporal, and byte pairs. Both coverage gaps are fixed in the
reviewed commit. No product mismatch appeared in the tested domain.

## Law and evidence boundary

Two values belong to the same D2 equality key exactly when their equality
operands have the same query IR identity. The pair grammar declares equality
before it calls either identity path. It checks both keys and the compiled
equality predicate when each key is constructed. Nullish predicate results are
`null`, although the two identity keys remain distinct.

The fixed cases cover signed zero, NaN, invalid Date, Date/timestamp, nullish
values, BigInt, infinities, reserved-looking strings, empty binary values,
Temporal types and dates, typed-array constructors, symbols, and functions.
The generated cases vary primitive values, valid Date timestamps, Temporal
dates, byte content and length, and nested references. Fixed and sampled pairs
do not establish universal agreement for arbitrary JavaScript values or hash
collision freedom. Ref proxies are expressions, not literal values here.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract | `getEqualityValueIdentity` promises the equality relation for keyed state. Query IR equality operands preserve that relation for query reuse. The bounded domain and omissions appear above and in the coverage map. |
| ORC-002 Independence | Each pair carries its expected relation before production runs. The expected result does not call `normalizeValue`, either identity path, or the predicate evaluator. |
| ORC-003 Responsibilities | The oracle file states the law, pair model, value grammar, two key drivers, predicate driver, and key-construction check together. |
| ORC-004 Grammar | The fixed cases reconstruct the audit's signed-zero and binary examples. Equal and unequal generated Date, Temporal, and byte pairs distinguish value equality from broad collapsing. The bounded Date range stays 1,000 ms inside valid endpoints. Temporal days vary within January and cross a month boundary. Byte lengths span 1–140, with empty bytes fixed. Removing an axis loses its type boundary. Ref proxies are excluded because the IR treats them as expressions. |
| ORC-005 Path and observation | The check calls the real D2 key path, the real IR demand-key path, and `compileExpression`. It observes key equality and predicate output immediately after construction. |
| ORC-006 Calibration | An IR signed-zero mutant failed the fixed signed-zero assertion. A constructor-sensitive binary mutant failed on empty Buffer versus Uint8Array. A binary-content collapsing mutant failed the generated IR-key assertion on Buffer `[0]` versus Uint8Array `[1]`. Each result was an assertion failure at the intended checkpoint. The mutants were reverted. |
| ORC-007 Campaign and replay | The package oracle command includes the file. Fixed seed `20260928` and a seedless campaign use the same property and 160-run budget. The named replay manifest owns `query-identity.equality-partition`. Guarded replay of seed `20260928`, shrink path `1:0:0`, selected the property and reproduced the binary-content collapsing mutant. |
| ORC-008 Model state | Not applicable. The pair relation has no state or next action. |
| ORC-009 Vocabulary | `EqualityPair` is a model-only description of two values and their declared relation. D2 key and IR operand key name the two production observations. |
| ORC-010 Failure fidelity | The property has no acquired resource to clean up. Fast-check shrank the binary-content mutant to one differing byte and kept the IR-key assertion as the primary failure. Guarded replay retained the same binary-content failure. |
| ORC-011 Second formulation | The declared relation checks each identity independently. The compiled predicate supplies a third observation of the same declared pair without serving as the model. This detects a shared identity error against the declared relation. |
| ORC-012 Review record | This record names every applicable requirement, the reviewed executable commit, controls, limits, and replay evidence. |

## Verification

- The final oracle file passed 32 tests. The neighboring identity tests and
  named replay manifest checks passed in the focused run.
- TypeScript, ESLint, Prettier, and `git diff --check` passed on the reviewed
  executable commit.
- The three temporary mutants failed by assertion. None timed out or failed
  during setup.

## External-review follow-up

Reviewed executable commit: `f83aaedb9cf267f1997152641442bc6f29bce453`.
The earlier record above applies to `7f8617a4`. The later PR head
`ff90c360` added only that record. The external review then called the PR
test-only and clean with zero findings. The production diff remains zero, but
the zero-finding verdict missed four oracle evidence gaps:

- **ORC-004:** The generated string branch originally compared a string only
  with itself. A mutant that collapsed all primitive strings to one D2 key
  passed all 20 equality checks. The first repair added unequal strings but
  only with different lengths. A first-character-plus-length key mutant then
  passed all 40 equality checks. The final grammar includes empty/equal strings,
  different strings, and same-prefix, same-length unequal strings. The fixed
  `ab`/`ac` pair and generated unequal pairs both reject that mutant.
- **ORC-005:** Fixed pairs now run a public live-query `groupBy`. After initial
  publication, the check compares group count and row multiplicity with the
  declared pair relation. Under the first-character-plus-length mutant, the
  `ab`/`ac` public result had one group instead of two. The generated key check
  still observes internal identity, and no end-to-end subscription test proves
  subset-demand reuse. The coverage map assigns that witness to this owner.
- **ORC-007:** The original replay evidence omitted its command and test-name
  filter. The direct command below selected one property execution. With the
  first-character-plus-length mutant it reported `failed:true`, at the D2-key
  assertion, for seed `20260928` and path `8:0:0`. After reverting the mutant,
  the same command reported `failed:false`.
- **ORC-012:** This entry identifies the exact executable commit reviewed for
  the follow-up. Any subsequent record-only commit does not change that code.

From `packages/db`, the direct replay command is:

```sh
TANSTACK_DB_ORACLE_PROPERTY=query-identity.equality-partition \
TANSTACK_DB_ORACLE_SEED=20260928 \
TANSTACK_DB_ORACLE_PATH=8:0:0 \
node --import tsx tests/oracle-replay.ts \
  tests/query/identity-output-shape-oracle.test.ts \
  -t 'agrees across the supported value grammar, seed=undefined' \
  --maxWorkers=1 --coverage.enabled=false
```

The fixed-seed mutant campaign failed after nine cases and shrank to
`left: "  "`, `right: " a"`. The guarded replay reached one execution and
preserved the same failure class. All temporary mutants were reverted.
The clean oracle passed 56 tests, the guarded replay and manifest suite passed
27 tests, and ESLint, Prettier, and `git diff --check` passed. The additional
public path covers the fixed value pairs at initial publication; it does not
close the mapped subset-demand reuse cell.

## Main merge verification

Reviewed merged executable commit: `d4f0507892584a2e59e96baea498989c41a2ae21`.
The merge kept the query-identity coverage note and main's SQLite coverage
notes. It changed no query-identity oracle or runtime source from the
follow-up reviewed above. At the merged commit, the oracle passed 56 tests,
the direct seed `20260928` and path `8:0:0` replay completed one execution,
and Prettier and `git diff --check` passed. The next record-only commit adds
this entry and changes no executable code.

## Current-main merge verification

Reviewed merged executable commit: `c795bf24f417ac6342e8c45c19e5175d8a625e13`.
This normal merge brought in `origin/main` at `63362dc8` and retained both
the query-identity coverage note and the newer coverage and oracle
registrations from main. It made no query-identity runtime or oracle changes.
The merged oracle passed 56 tests. Direct seed `20260928`, path `8:0:0`
replay selected one property execution and reported `failed:false`. ESLint,
Prettier, and `git diff --check` passed.

For calibration, I temporarily changed the D2 equality key for primitive
strings to either one constant or the first character plus length. Each
mutant made the generated seed check fail at the D2-key assertion. Each also
made the public `ab`/`ac` grouping check show one group instead of two. A
direct replay of the first-character-plus-length mutant selected one property
execution and reported `failed:true` at the same-prefix string assertion.
Both mutants were removed after their RED runs. The later record-only commit
changes no executable code.
