# Aggregate select structural reach, 2026-11-02

## Binding and diagnosis

Base: `a3c4d0676621cc7df4d242bdfe31815509add734`, the exact main commit
of Release run 41484825362. Job 125412837396 failed the random
`aggregate.select-shapes` campaign at its final reach assertion. Both string
ordering states had count zero. The job reports 14,748 passing tests, one
failed test, 196 files and no type errors. No production comparison mismatch
was reported. The coverage map had already recorded this sampling gap.

The ordered-shape grammar always selects a string group key where available.
Its randomly chosen terms can all avoid that field. More random reruns cannot
establish seed-independent structural reach. This repair changes test
instrumentation only. It adds no product law or production code.

Reviewed source: `packages/db/tests/query/aggregate-select-oracle.property.test.ts`,
SHA256 `bf90c7266c23765220384d5a027de1810bb01b09bfc7409f4d70d264b3329ad4`. This record binds that source hash to the results below;
the commit containing this record supplies its immutable Git binding.

## Law, reach and evidence

**Law and authority:** The existing aggregate owner, the query guide's
“Ordering by SELECT Fields” and “Multiple Column Ordering”, and the live-query
architecture's aggregate-select law remain unchanged. Published rows match
independent aggregate recomputation. Explicit string order uses `en-US`
collation. ORC-015 requires the declared premises to be reached.

**Repair:** Twelve structural histories use the same `runHistory`, independent
model and published-row comparison as the broad grammar. Both campaigns run
those histories first, in addition to their unchanged 160 generated histories.
`createOracleReach(..., { fixedHistories: 12 })` requires each of the 21
states in the structural set itself. The minimum remains one. The fixed seed
remains 2094; the random campaign retains its fresh seed. A selected seed/path
runs only the requested replay through the shared replay interface.

**RED:** The authoritative main CI failure above establishes the old missing
reach. Its seed was not captured because the failure occurred after the
property completed. The first local structural draft also failed correctly:
its count-ordered pair groups all tied, so three declared ordering states had
no structural witness. Replacing that case's count with a sum establishes
distinct blocks. This intermediate failure was a reach failure, not a runtime
defect or final-source evidence.

**GREEN:** With unchanged production, the final source passes all six tests:
twelve structural plus 160 generated histories in each campaign, and four
existing model replays. Focused TypeScript, formatting, whitespace and `pnpm lint:changed` pass. ESLint reports zero errors
and three existing `no-shadow` warnings on unchanged declarations. Cached
local Vitest is 3.2.4; CI uses 4.1.12. No installation or lockfile change ran.

**Calibration:** Removing the final structural string history makes the fixed
campaign fail its fixed-reach assertion for both string states and three-key
groups. The broad generator still runs. This rejects random reach as a
substitute for structural coverage. Changing the driver's requested collation
to `lexical` fails `initial: top-level rows in orderBy position 0`, with
`A` before `a` instead of the model's locale order. Seed 2094/path 11 repeats
that assertion failure in one test, with the other five tests standing aside.
Restoring the source makes the same replay pass. These are assertion failures
at the intended comparison, not timeouts or setup failures. All temporary
mutants were restored; production sources were never edited.

Normal command, from the isolated checkout:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm_config_verify_deps_before_run=false node node_modules/vitest/vitest.mjs run --config /private/tmp/callback-metadata/aggregate-select-reach/vitest.config.mjs
```

Replay adds `TANSTACK_DB_ORACLE_PROPERTY=aggregate.select-shapes`,
`TANSTACK_DB_ORACLE_SEED=2094` and `TANSTACK_DB_ORACLE_PATH=11`.
The config uses this checkout's DB, db-ivm and store source, jsdom, the DB
setup file and one worker, without coverage or broad typecheck runs.

| Declared state | Fixed campaign histories | Random campaign histories |
| --- | ---: | ---: |
| bare include: field | 12 | 17 |
| bare include: nested | 13 | 8 |
| bare include: case | 10 | 12 |
| toArray include in a conditional branch | 12 | 12 |
| bare group keys without an aggregate | 18 | 30 |
| bare group keys beside an aggregate | 64 | 66 |
| include() wrap | 24 | 34 |
| materialize() wrap | 23 | 29 |
| grouping stripped alone: grouped | 30 | 26 |
| grouping stripped alone: one group | 10 | 8 |
| grouping stripped alone: HAVING aggregate | 28 | 25 |
| include runtime stripped | 14 | 14 |
| orderBy aggregate stripped beside a select aggregate | 33 | 21 |
| an aggregate orders the published rows | 25 | 16 |
| a number select field orders the published rows | 12 | 11 |
| a string select field orders the published rows | 3 | 6 |
| a string field orders A against a lowercase key | 3 | 5 |
| two orderBy terms order the rows | 10 | 10 |
| an include query orders its rows | 32 | 27 |
| two group keys publish several groups | 8 | 7 |
| three group keys publish several groups | 7 | 2 |

Each state also occurred in the structural set, as its separate enforced
fixed-reach assertion proves. Counts include the structural set and generated
histories; they are not generated-only counts.

## Oracle review

This is a self-review, not a fresh external review.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Existing authority and domain retained; this repair closes sampling reach only. |
| ORC-002 | Independent model and locale comparator unchanged. |
| ORC-003 | Opening grammar prose and structural-history prose explain the additional premises. |
| ORC-004 | Existing broad grammar unchanged. Structural cases reconstruct the previously legal string witness. Removing it fails reach. The adjacent `upper` grouping collapses `a`/`A`; `key`, `pair` and `triple` retain raw keys. Source fields outside group keys and aggregates remain rejected. |
| ORC-005 | Real Collection queries and initial/after-step public comparisons retained. No missing-source-input hypothesis was identified; the driver preloads all initial rows. |
| ORC-006 | Code-unit collation injection fails the published-row comparison and its direct replay. |
| ORC-007 | Same examples, generator, driver, comparison and 160 generated runs in fixed and fresh campaigns. Direct replay runs one requested history. |
| ORC-008 | No reference-model state changed. |
| ORC-009 | No new subsystem concept or model abstraction. `fixed` labels a test history's structural provenance. |
| ORC-010 | Existing cleanup unchanged. Fast-check captures the structural counterexample and replay path. |
| ORC-011 | No new shared-model semantic hypothesis; ordering authority and independent comparator unchanged. |
| ORC-012 | This record binds all outcomes to the source hash and preserves intermediate failures separately. |
| ORC-013 | `a` versus `A` distinguishes locale from code-unit order at initial publication. |
| ORC-014 | Claim stays at the existing controlled Collection/jsdom boundary. No new provider or framework claim. |
| ORC-015 | All 21 minima retained; each is now additionally required in the structural set. |
| ORC-016 | Structural inputs replay the shared model and comparison without separate expected values; no unit test added. |

**Limits:** This establishes stable reach of existing declared states. It does
not prove all possible shapes, all mutations or all comparator behaviors.
The original owner still excludes raw-expression ordering and boolean, Date,
NaN and object order fields. The structural prefix has no mutations; the
unchanged generated histories vary updates, deletes, routes, shadowing,
operator removal and shape expressions. Direction and multi-term sensitivity
outside this collation calibration retain the owner's historical evidence.
No full repository test/build, publication, or release PR merge ran.

## Local evidence hashes

Logs are under `/private/tmp/callback-metadata/aggregate-select-reach`.

| Log | SHA256 |
| --- | --- |
| `first-tests.log` | `056deb18796f2d4d74dd777c73bd194503d1856c37caeacd30d155e118c4b51d` |
| `final-tests.log` | `5622b1e0564c9922618001287d509c0a10107a62a1e55eefc6193168cc5a4be6` |
| `missing-structural-string.log` | `533a83212c25eb3a45a874e2351fba44ef64e5c71cd15c8383f9440cb74a7e3c` |
| `code-unit-mutant.log` | `4b458e6abc7e98bada1ff19cb8dacf8265130607efb752e3f80519b1cbcf132a` |
| `code-unit-mutant-replay.log` | `2d17f5f8e4409e743ec16783ba21c924c4846c13def96cfa44ee2cb03b8f1a1f` |
| `repaired-replay.log` | `ac5d720b4e6a027c2ad3c1fa798b5667e44259248d0563edde2990bbb27dd2c5` |
| `types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `eslint.log` | `0a30e682ec11fc930d253804af5bc4df8de96e0972b64b856500704128b1f0cf` |
| `lint-changed.log` | `89d7da780deb04850db632f478bc4155d23659849c0e5bec6d114c74dc9d5168` |
