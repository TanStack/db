# BasicIndex build with a nullish value

At PR head `175adce0cb32e29e5838853c821ee5c56fe0089a`, a focused runtime
witness built a direct BasicIndex from `undefined` and `1`. The default
comparator places `undefined` first. `BasicIndex.build` returned
`takeFromStart(2) = [one, undefined]` and an empty inclusive upper range
bounded by `undefined`. Incremental `BasicIndex.add` and both BTreeIndex paths
returned `[undefined, one]` and the expected range. A recording comparator
received no calls during the BasicIndex build. The build path is also reached
when `Collection.createIndex` builds an index over existing rows.

The accepted law is the default ascending, nulls-first order documented by
`DEFAULT_COMPARE_OPTIONS`, `defaultComparator`, and the direct `IndexInterface`
contract. The primary `index-update-oracle.property.test.ts` already models
nullish positions with a source Map, but its nullish history grammar previously
used add/update/remove only; its generated build grammar used numeric values.
The smallest missing cell is `undefined` plus `1` through `BasicIndex.build`,
observed with `takeFromStart(1)` and an explicit upper range. A two-order
fixed build history and generated nullish builds now use the same Map checker
after each returned action. The Map distinguishes exact null and undefined
membership while its ordered projection treats them as one comparator
position. Raw duplicate source keys are resolved before build; mixed value
classes and custom comparators remain outside this claim.

## RED evidence before the production change

The new fixed oracle witness failed on the unchanged implementation:
`BasicIndex nullish direct index refinement > build preserves nulls-first
ordered reads and ranges` compared `takeFromStart(1)`, receiving `[one]`
against source-model `[undefined]` at the intended observation checkpoint.
The BTreeIndex version passed. The command's focused run had one failed test,
one passed test, and no type errors. This is a product mismatch, not a setup
failure or a changed expectation.

Native `Array.sort` moved a raw `undefined` element to the end without invoking
the supplied comparator. `BasicIndex.build` now sorts wrapper records, so every
stored value reaches the configured comparator, then unwraps the sorted values.
The fixed two-order build history and generated put/delete/build histories
pass through the same independent Map checker after each returned action.

## GREEN evidence and hostile review

The complete direct index oracle passed 412 tests with no type errors after the
repair. The fixed history includes both source insertion orders and a later
build with `undefined`, `null`, and a defined value. The generated grammar can
replace an existing source Map through build. The fresh hostile reviewer
`/root/review_nullish_build_oracle` inspected the original RED witness, the
model, both index implementations, and the repair. It found no blocker for the
bounded direct-index law. It did not claim that a Collection query using a
newly built index has been observed publicly.

The oracle's model derives exact membership and sorted source keys from the
source Map, not from either index. A build that leaves `undefined` last fails
`takeFromStart(1)` at the returned-action checkpoint. Range and cursor probes
also compare against the Map after each action. The direct-index law excludes
raw duplicate-entry builds, mixed string/number order, custom comparators,
Collection queries, and work complexity. Its fixed and generated build cells
do not establish every possible source history. The exact committed-head
review is recorded in a later entry.

## Exact committed-head hostile recheck

The reviewed commit is `9a145fba130f27c914a4a1fd4f44c5871a917483`.
`/root/exact_review_index_build` read the source-isolated index retirement
ledgers, the index oracle and coverage map, the direct index implementations,
and the default comparator and interface contracts. The commit preserves the
earlier RED witness: its parent still sorts raw values, so native `Array.sort`
moves `undefined` behind `1` without calling the comparator. The repaired
build sorts objects that hold the values; this invokes the checked comparator
for that pair and leaves equal comparator positions stable. This recheck
inspected the parent implementation and the recorded RED run; it did not
execute the parent commit again.

The committed direct index oracle passed 412/412 tests with no type errors.
The guarded replay of `index-update.nullish-membership` at seed `20261012`,
path `0`, reached both index classes for 100 runs each and passed. `git show
--check` passed, and the worktree was clean after those runs. No new unit test
was retired by this build repair. The earlier retirement ledgers still delimit
the assertions removed from their source files.

| Requirement | Exact-head result |
| --- | --- |
| ORC-001 | `DEFAULT_COMPARE_OPTIONS`, `defaultComparator`, and the direct `IndexInterface` methods support default ascending, nulls-first returned results. The interface lists methods but does not itself spell out this order. The claim is limited to direct default-option reads over `undefined`, `null`, and positive numbers. |
| ORC-002 | A source Map owns exact key/value pairs. Its `nullishPosition` projection freshly sorts and filters rows without production normalization, comparator, index storage, or traversal. |
| ORC-003 | Opening and adjacent oracle prose states the law and limits, Map rule, legal put/delete/build histories, direct BasicIndex/BTreeIndex path, returned arrays and sets, and the after-action comparison cut. |
| ORC-004 | The fixed trace reconstructs `undefined` plus `1` in both build insertion orders, a put after build, then a four-key replacement with `undefined`, `null`, and `1`. Generated histories use three keys, five values, 1–40 actions, and builds of at most three entries. Removing build loses the full-sort path; removing `undefined` loses the native-sort distinction; removing defined values loses the nullish boundary; removing replacement loses stale-owner detection. Duplicate generated keys are resolved by the Map before build. Raw duplicate-entry builds, other value domains, and direct updates of absent keys are excluded. |
| ORC-005 | The oracle invokes real direct `build`, `add`, `update`, and `remove` methods, then compares exact membership sets, complete forward range sets, and ordered key arrays after each returned action. `takeFromStart(1)` observes the original defect. No public Collection query is claimed. |
| ORC-006 | The recorded unchanged-production run failed at the `takeFromStart(1)` refinement comparison, with `[one]` instead of `[undefined]`; this is an assertion failure at the intended cut. The repaired version passes. No additional production mutant was run in this recheck. |
| ORC-007 | Fixed-seed and seedless lanes share the generated action grammar, recorder, comparison, and 100-run budget. The exact-head guarded seed/path replay reached two 100-run executions. The earlier round-4 ledger records a captured failure replay for this named property, before the build action changed its arbitrary. A captured failing seed/path for the revised arbitrary was not independently checked in this recheck; that replay-fidelity cell remains open. |
| ORC-008 | The existing Map retains key/value ownership because later put and delete actions distinguish owners. Build adds no independent model state; it replaces that Map. |
| ORC-009 | Model `put` maps to add or update according to Map ownership, `delete` to remove when owned, and `build` to a full replacement. The model-only comparator position combines null and undefined for order while exact membership keeps them separate. |
| ORC-010 | The action loop has no external resources. The guarded replay retains its named witness and removes its private temporary channel; the recorded original failure remains distinct from a setup or cleanup failure. |
| ORC-011 | No plausible fault shared by this bounded source-Map rule and production was identified. Nullish position follows the accepted default comparator contract; mixed domains and custom comparison need separate laws. |
| ORC-012 | This append-only entry ties the exact-head review, executed GREEN result, inspected RED path, guide audit, and limits to the reviewed commit. The revised-arbitrary failure replay named under ORC-007 is the remaining conformance evidence gap. |
| ORC-013 | The two-entry `undefined`/`1` build reaches the law's premise. The first fixed observation rejects the plausible wrong rule “native sort may place undefined last”; reversing source insertion order distinguishes an accidental insertion-order pass. |
| ORC-014 | No controlled provider or host premise supports a claim about real-provider behavior. Direct index results are the stated boundary. |

There is no blocker for the bounded direct-index code or its source-Map
comparison. This result does not establish Collection query selection after
`createIndex`, custom comparator behavior, mixed string/number ordering, raw
duplicate-entry builds, all range shapes, or work complexity. The revised
arbitrary's captured-failure replay remains to be recorded before claiming
complete ORC-007 conformance for the expanded generated property.

## Revised-grammar failure replay calibration

This follow-up closes the ORC-007 evidence gap above for the oracle at reviewed
commit `9a145fba130f27c914a4a1fd4f44c5871a917483`. A temporary wrong
expected result was inserted after the nullish action checker: whenever a
generated `build` returned, it required `takeFromStart(1)` to equal the
impossible key `calibration-only-missing-key`. This deliberately faulty
expectation did not modify production or the action arbitrary.

The seedless generated lane failed at the returned-build endpoint comparison
for BasicIndex after one test, seed `1770427226`, shrink path `0:0`. Its
counterexample was one empty build; the actual endpoint was `[]`, while the
temporary expectation was `[calibration-only-missing-key]`. BTreeIndex also
failed at the same temporary assertion in its seedless lane. Guarded direct
replay of `index-update.nullish-membership` with the BasicIndex test selector,
seed `1770427226`, and path `0:0` reached exactly one property execution. Its
witness recorded one run and `failed: true`; Vitest and the replay guard exited
nonzero with the same endpoint assertion. This is an assertion failure at the
intended comparison, not a setup error or timeout. It demonstrates replay
fidelity for the revised arbitrary; the empty-build case is a replay control,
not the nonempty nullish-order product witness.

After removing the temporary expectation, the same guarded seed/path replay
reached one BasicIndex execution, recorded `failed: false`, and passed with no
type errors. `git diff --exit-code --
packages/db/tests/index-update-oracle.property.test.ts` confirmed that the
oracle file again matched the reviewed commit. No calibration fault remains.
The preceding ORC-007 and ORC-012 gaps are closed by this executed evidence.

## Transfer-only narrowing

The later production refactor groups each normalized build value during the
existing entry pass. It removes the intermediate entries array and keeps the
wrapper sort that fixes the nullish position. A fresh hostile recheck read
the source Map model, original unit ledgers, and current build code. Its
focused index, work, and Collection-index run passed 535 tests with no type
errors. The recheck found no lost direct-index assertion after the grouping
change. It did not rerun the original wrong-sort mutant or extend the law to
raw duplicate source keys or custom callbacks within one normalized value.

At exact code commit `24a61a8d5b6cef06d488c490e39f351b4d55fb68`, a
fresh hostile reviewer rechecked the one-pass build against the seven retired
index law families and the nullish fixed history. The source Map, wrapper
sort, and direct observations remained intact after the commit hook. A
focused index, work, and Collection-index run passed 535 tests with no type
errors. The reviewer found no in-scope loss. This recheck did not rerun the
original wrong-sort mutant; the earlier RED run remains the sensitivity
evidence.
