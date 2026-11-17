# Reversed-index campaign conversion

This test refactor converts the reversed-index owner to `oracleProperty`. Production is unchanged. The baseline is `9a5214f2801c2c7918f6fd21ac5add317559322a`. The [companion JSON](2026-11-10-reverse-index-property-conversion.json) binds reviewed source commit `3e6c0db1a897390bd0266fb09f836d842bb5653c`, source hashes, complete mutation identities, results, and controls.

## Laws and independent judgment

The query-aware reversed reader returns the accepted ordered prefix, or the strict suffix after a value cursor. It keeps the query's null placement. Non-null filter work stops at the requested accepted prefix. Each nullish key may receive one filter call per read. Authority remains the `IndexReader.take`/`takeFromStart` contract and the [Ordered acquisition coverage owner](../oracle-coverage.md).

The existing independent model sorts plain `[key, value]` pairs, chooses the cursor suffix, and computes accepted keys and allowed non-null calls. It imports no production ordering helper. The production driver creates a real `BTreeIndex`, wraps it in the query-aware `ReverseIndex`, and records returned keys and filter work at `read returned`. Exact order and the two work bounds remain separate named judgments.

The generated domain remains unique keys 0..15, null/undefined/0..4 values, zero to twelve rows, requested sizes zero to six, both physical directions and null placements, optional nullish/numeric cursors, and zero to six rejected keys. A tuple-based unique-array arbitrary replaces a dependent chain so constructed histories can be checked for grammar membership and shrunk. The run budget remains 200. Fixed campaign seed 2045 and the matching random campaign remain. All four large reads remain as finite histories of `reverse-index.large-reads`, using the same model, driver, and check. They do not count toward generated reach.

## Construction integrity and failure fidelity

Nine builders construct the declared semantic states. Every invocation returns a fresh object. A WeakMap associates its declared obligations with generated and shrunk outputs, as well as seeded examples. The model carries this test-only provenance. The shared check compares it with observations from the actual read and filter callbacks. This compensates for e1fb504's association of construction requirements with seeded example identities only.

Original product-law judgments run first. A missing constructed state uses virtual `constructed states`, which the driver never records. It therefore cannot replace a driver failure with an invented observed violation.

Executed controls:

- At campaign seed 42, nine seeded examples precede generated histories. Generated path 9 requires `zero read`. Temporarily omitting that observation only for fresh generated constructions passes with native initial-example enforcement when the shared reach check is bypassed. The zero-read count is zero.
- Enabling the shared check rejects the same omission as `constructed reach` at `constructed states`. Shrinking retains that judgment at path `9:0:0:0:0:0:0`. The exact mutated replay fails. The clean restored replay passes.
- A temporary sentinel error immediately after the read-return observation remains the primary `Error: reverse late-driver sentinel`. Missing later reach does not replace it with an `OracleViolation`.
- Permanent calibrations challenge a missing constructed observation, an extra key, excessive non-null filter calls, and a repeated nullish filter call through the shared judgment.

All temporary edits were restored byte-for-byte before the full AFTER run.

## Complete mutation comparison

Both runs use the unchanged e1fb504 installation, campaign seed 42, prefix `TANSTACK_DB_ORACLE`, and one context. Neither run filters or samples mutation sites. The BEFORE is cold. The AFTER starts a fresh daemon after archiving the old cache, whose prefix was unknown. The recorded runtime state confirms `TANSTACK_DB_ORACLE_SEED`, and the full framework file hashes remain unchanged. Daemon reuse is accepted only within this isolated prefix.

Commands, from the worktree root:

```sh
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/@tanstack/oracles/oracle-gaps/index.mjs --package packages/db --source src/indexes/reverse-index.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out .cache/oracle-conversion-recovery/reverse-before
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/@tanstack/oracles/oracle-gaps/index.mjs --daemon --package packages/db --source src/indexes/reverse-index.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out .cache/oracle-conversion-recovery/reverse-after
```

The completed BEFORE contains all 49 static sites: 23 killed, 15 unreached, 5 survived, and 6 runtime crashes. Its six crashes are actual TypeErrors. No thrown-law rejection is hidden as a crash. The completed AFTER has identical outcomes at every site: 23 killed, 15 unreached, 5 survived, and 6 TypeError crashes. All 23 prior semantic kills are named `order` violations. Both reports have zero reused units and no reversed-index nondeterminism. The comparator verified all 3,597 tracked AFTER inputs and every installed framework hash unchanged. The comparator required every prior kill to remain a named rejection by `order`, `non-null work`, or `nullish work`. A construction-reach-only rejection does not count.

## Validation and limits

The normal focused run passes 12 tests with no type errors. A reseeded campaign at 42 passes. Prettier, ESLint, changed-file lint, and diff checks pass. No run budget is lowered or removed. The companion JSON records each declared state's fixed and reseeded counts, report hashes, and complete before/after stable keys. The complete captures report 69 nondeterministic tests in unrelated owners in each phase, with none in the reversed-index owner. BEFORE computed 274 units; AFTER computed 275. Their mutation phases took 11.852 and 7.2 seconds.

| Guide requirement | Evidence |
| --- | --- |
| ORC-001–003 | Established reader contract and explicit domain; independent sorting/prefix model; distinct literate grammar, driver, and named comparisons. |
| ORC-004 | The four large histories are retained verbatim as model inputs. The generated grammar retains every bounded dimension. Direction/null-placement axes change order, cursor axes change the eligible suffix, rejection changes accepted prefixes and work, and zero/empty inputs distinguish boundary reads. Duplicate keys and out-of-domain values are invalid. |
| ORC-005–007 | Real query-aware index reader and filter callbacks; exact return cut; four shared calibrations; unchanged fixed/random budgets; executed seed-and-path RED/GREEN control. All source entries precede the read, so no missing-input hypothesis arises. |
| ORC-008–009 | No stateful product model introduced. Construction requirements are explicitly test-only provenance, with no product-state counterpart. |
| ORC-010 | Semantic mismatches retain priority. Generated omission shrinking and direct replay preserve the named judgment. The late-driver control preserves the sentinel as primary. |
| ORC-011 | No new shared semantic-fault hypothesis arose. Existing independent array sorting and prefix counting remain unchanged. |
| ORC-012–013 | This record binds the exact source commit and hashes. Empty/zero reads, nullish/numeric cursor boundaries, null placements, and separate work calibrations distinguish nearby rules. The large-history claim remains limited to its four cases. |
| ORC-014 | Not applicable: this owner exercises the reader directly and transfers no controlled provider or framework premise. |
| ORC-015–016 | Twelve semantic states are constructed and measured in both campaigns. Four large histories and all calibrations use the shared judgment. No unit test is added to the oracle. |

This conversion claims preservation of the existing query-aware order and work judgments. It does not claim closure of unchanged source gaps. Legacy reversal without query-aware null placement, lookup/range delegation, optional filter behavior, capability admission, and unexercised metadata remain outside this converted grammar. Six runtime crashes remain separate from semantic kills. Existing owner limits remain in the coverage map. The complete package capture can report nondeterminism in unrelated owners; the reversed-index owner must have none in either accepted report.

Focused command:

```sh
pnpm_config_verify_deps_before_run=false pnpm --filter @tanstack/db exec vitest run tests/reverse-index-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
```

Checked exact replay:

```sh
TANSTACK_DB_ORACLE_PROPERTY=reverse-index.reads TANSTACK_DB_ORACLE_SEED=42 TANSTACK_DB_ORACLE_PATH=9:0:0:0:0:0:0 pnpm_config_verify_deps_before_run=false pnpm --filter @tanstack/db exec vitest run tests/reverse-index-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
```

## Integration review

Independent review verified all 49 static site identities against both raw
reports, all 23 retained named `order` rejections, the framework and source
hashes, and the preserved laws, histories, budgets and failure priority.
The review found that the author's branch registered the finite
`reverse-index.large-reads` property without a replay owner. Integration adds
it to the existing owner group and enumerated-property set. Its advertised
direct command passes all four cases and its determinism check (five tests),
with seven unrelated tests skipped and no type errors. The full owner still
passes all 12 tests. This changes replay discovery only; the source-bound
mutation pair above remains unchanged.
