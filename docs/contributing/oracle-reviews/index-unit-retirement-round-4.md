# Index unit retirement: undefined ordered reads and ranges

The source-isolated Field Lab loss audits compared the remaining direct
traversal and range blocks in `btree-index-undefined-values.test.ts` against
`index-update-oracle.property.test.ts` at frozen head
`df18f41bba07589c4aa8a4b17ca676be7d39dc15`. The receiver checked one-owner
undefined cursors and numeric ranges, but its generated nullish lane checked
only exact and `IN` membership. The table freezes the source assertions before
changing the receiver. A proposed witness is not retirement evidence until it
executes, rejects a wrong result, and survives hostile review.

| Legacy block | Source assertion at the returned-action checkpoint | Loss in frozen receiver | Proposed transfer |
| --- | --- | --- | --- |
| `take(n, undefined)` versus `takeFromStart(n)` | After `a=undefined,b=1,c=2`, `takeFromStart(3)` has three keys and `take(3, undefined)=[b,c]`. | The explicit cursor has a singleton analogue; the default-policy endpoint cut is absent. | Sort source rows with nullish values first; compare both exact arrays after each add, with a fixed three-row history. |
| `takeReversed(n, undefined)` versus `takeReversedFromEnd(n)` | In a fresh copy of the same state, the endpoint returns three keys and the explicit cursor returns none. | The explicit reverse cursor has a singleton analogue; the nullish endpoint cut is absent. | Compare both exact reverse arrays in the same fixed history. |
| Store and retrieve three undefined owners | After `a,b,c=undefined`, `takeFromStart(10)=[a,b,c]` and `equalityLookup(undefined).size=3`. | Two-owner exact membership is fixed; three-owner ordered output is absent. | Pin all three owners and compare exact arrays and source-derived equality sets. |
| Remove one of two undefined owners | After adding `a,b=undefined` and removing `a`, exact lookup has size one and contains `b`. | Reachable in generated put/delete histories, but the two-owner deletion cut is not pinned. | Pin the removal and compare the complete exact set after it returns. |
| Iterate past multiple undefined owners | After `undef1,undef2,undef3=undefined`, then `one=1,two=2`, `take(10,undefined)=[one,two]`. | One-owner cursor and multi-owner membership checks never meet. | Pin the five-row history and compare exact cursor arrays after each add. |
| Explicit undefined versus omitted lower range bound | After `undef=undefined,one=1,two=2,three=3`, `{from:undefined,to:2}` inclusive returns exactly `{undef,one,two}`; `{to:2}` returns three keys. | Numeric bounds and nullish upper-only reads are separate fixtures. | Source-derived range sets check explicit and omitted lower bounds, plus exclusive variants that distinguish them, after a fixed four-row history. |
| Double undefined range bound | After `a,b=undefined,c=1`, `{from:undefined,to:undefined}` inclusive returns exactly `{a,b}` and excludes `c`. | No double-bound range check with two undefined owners. | Pin this state and compare the full set against source-derived bounds. |

The proposed law follows `DEFAULT_COMPARE_OPTIONS` and `defaultComparator`
in `packages/db/src/utils.ts` and `packages/db/src/utils/comparison.ts`, the
direct cursor comments in `packages/db/src/indexes/btree-index.ts`, the
key tie-order contract exercised by `deterministic-ordering.test.ts`, and the
frozen legacy assertions. `IndexInterface` establishes the direct methods but
its reference page does not specify these ordering details. The bounded law
uses default ascending order with nullish values first, positive numbers
ascending, and row keys ordered within one comparator position. Its domain is
`undefined`, `null`, and the numbers 1–3; negative numbers are outside it.
`null` and `undefined` occupy one comparator position for ordered reads while
remaining distinct exact lookup groups. A source Map retains key ownership.
The model sorts and filters that Map; it does not call the index comparator,
normalization, cursor, or range machinery to compute expected results.
`take` and `takeReversed` exclude the cursor's comparator position. Endpoint
methods have no cursor. A range bound exists only when its field is supplied;
an inclusivity flag without that bound has no effect. The production path is
the direct `IndexInterface` on both BasicIndex and BTreeIndex. Unfiltered
ordered arrays at n=1, 3, and 10 and full sets for ten selected forward range
shapes are compared after each add, update, or remove returns. The owner does
not claim all bound combinations or filtered takes.

The default-order and string-order tests inspect `orderedEntriesArray`, a test
view of internal entries. Those two blocks remain until their private
observation has a receiving owner or the test's representation claim is
explicitly retired. The custom-comparator argument, `valueMapData` storage,
and public live-query blocks also remain. This direct-index law makes no claim
about those observations or live-query scheduling.

## Execution and hostile review

The seven ledger blocks were removed after the hostile review. The BTree file
now has five tests. The receiving oracle and that file passed together:
415/415 tests. The package TypeScript check and `git diff --check` passed.
The fixed-seed and seedless nullish campaigns run the same source actions,
checker, and 100-run budget for both index classes. A guarded replay at seed
`20261012`, path `0`, reached both classes with 100 successful runs each. The
named replay harness passed its 36 tests.

Five wrong-result controls force an endpoint read to lose the undefined owner,
an explicit cursor to repeat one of three undefined owners, an inclusive
explicit lower bound to drop undefined, a double undefined range to lose a
peer, and a null bound to drop its undefined comparator peer. Each fails the
intended source-Map comparison for both index classes and restores its spy in
`finally`. The earlier exact and `IN` controls continue to run.

For failure replay, a temporary wrong model rule cleared the expected set for
an explicit `undefined` lower bound and upper bound 2. The fixed campaign
failed at the forward range comparison on `put(a, undefined)`, seed `20261012`,
shrink path `0:0:0:0`. Guarded replay at that seed and path recorded one failed
run for each index class and exited nonzero. After removing the temporary rule,
the same guarded replay passed both classes. This was checker calibration, not
a production mutant or product defect. No production code changed.

The fresh hostile reviewer `/root/review_ordered_range_round4` read the full
legacy file, ledger, changed oracle, coverage map, reference material, and both
index implementations. It identified a surviving wrong design in the broader
claim: a range implementation could treat a `null` bound as an exact-null
bucket because no probe used null as a bound. Inclusive and exclusive null
probes plus a wrong-result control closed that gap. It also required the
contract authority and domain limits to be precise. Its final block-by-block
verdict found no lost source assertion among the seven retired blocks. It did
not run a production mutant. The default-order internal-entry, string-order
internal-entry, custom-comparator argument, storage-view, and live-query tests
remain in the source file.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | The default comparator, BTree cursor comments, deterministic key tie ordering, and frozen direct tests support the bounded law. The interface supplies the methods, not the full semantics. The claim is limited to default options, values `undefined`/`null`/1–3, unfiltered takes at n=1/3/10, and ten selected forward range shapes. |
| ORC-002 | A source Map owns rows. A fresh value-position sort predicts arrays; separate model-bound objects filter source rows for ranges. Neither calls production normalization, comparator, or traversal to compute an expected result. |
| ORC-003 | Opening and adjacent prose distinguish the law, source Map, action grammar, direct index driver, returned arrays/sets, and after-action comparison. |
| ORC-004 | Fixed three-row endpoint, five-row repeated-owner, two-owner removal, four-row range, and double-bound histories reconstruct all retired assertions. The generated put/delete tail has three owners and five values over 1–40 actions. Removing an endpoint method loses the absent-cursor distinction; one owner loses peer traversal; removing null loses comparator-position overlap; removing numeric successors loses cursor continuation; omitting bound presence loses the exclusive comparison. Negative numbers, arbitrary types, filtered takes, reverse ranges, and direct update of an absent owner are excluded. |
| ORC-005 | BasicIndex and BTreeIndex direct methods run after returned add, update, or remove. Exact arrays and complete sets preserve omissions, duplicates in arrays, order, and wrong membership. |
| ORC-006 | Five injected wrong results fail at the intended comparisons. The temporary wrong model rule failed at the forward range comparison and was removed. |
| ORC-007 | Fixed and seedless lanes use the same generated property and 100-run budget. Guarded seed/path `0` replay reached both lanes; captured failure path `0:0:0:0` failed both lanes under the temporary rule and passed after restoration. |
| ORC-008 | No model state was added: the existing Map retains owner-to-value association, needed for later update and delete. Sorted rows and bounds are recomputed observations. |
| ORC-009 | A model `put` maps to add or update according to source ownership; `delete` maps to remove when owned. Model comparator position combines null and undefined only for order/range, while exact membership keeps them distinct. |
| ORC-010 | Spies restore in `finally`; the guarded runner recorded the primary mismatch separately from process exit and removed its private witness channel. |
| ORC-011 | The reviewer found a missing probe, not a fault shared by the model and production. The added null-bound probe distinguishes the model rule from an exact-bucket interpretation. |
| ORC-012 | This versioned ledger holds source assertions, transfer, limits, execution, and the hostile verdict. Exact committed-head recheck is recorded in a follow-up entry below. |
| ORC-013 | Explicit inclusive versus exclusive undefined and null bounds, paired with omitted bounds, distinguish presence and comparator-position grouping. The wrong-result controls fail at those comparisons. |
| ORC-014 | No host or external provider behavior is claimed. |

The public live-query issue regression remains the only test in this file that
crosses the Collection/query path. The other four retained tests observe
private BTree ordering or storage and custom-comparator arguments; direct
source-Map arrays and sets cannot replace those observations without a
separate contract decision and receiving witness.
