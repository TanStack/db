# Index unit retirement: nullish exact membership

The source-isolated loss audit used baseline `73a5d4ec4`. The receiving owner is
`packages/db/tests/index-update-oracle.property.test.ts`. No source block below
was an exact witness in that baseline: its generated update values were numeric,
and its fixed nullish case read ranges and cursors rather than equality buckets.

## Transfer ledger before retirement

| Legacy block | Smallest source state and direct action | Exact source observation and law | Plausible wrong result |
| --- | --- | --- | --- |
| `index-update-short-circuit.test.ts`, `does not conflate undefined and null` | BasicIndex and BTreeIndex: fresh `a=undefined`; update `a→null` | At update return, `lookup('eq', undefined)=∅` and `lookup('eq', null)={a}`. The title states distinct exact membership. | A loose-nullish shortcut leaves `a` in the old bucket; a dispatch that returns the comparator group includes it in both. |
| `btree-index-undefined-values.test.ts`, `should update item from defined to undefined value` | BTreeIndex: fresh `a=1`; update `a→undefined` | At update return, `equalityLookup(1)=∅` and `equalityLookup(undefined)={a}`. | The old key retires but the new undefined key is lost. |
| Same file, `should update item from undefined to defined value` | BTreeIndex: fresh `a=undefined`; update `a→1` | At update return, `equalityLookup(undefined)=∅` and `equalityLookup(1)={a}`. | The new key arrives but the undefined membership remains. |
| Same file, `should update item from undefined to undefined (same value)` | BTreeIndex: fresh `a=undefined`; update `a→undefined` | At update return, `equalityLookup(undefined)={a}`. This checks conservation, not bucket identity. | Remove without re-add drops `a`. |
| Same file, `should handle mixed undefined and null values` | BTreeIndex: fresh adds `null1=null`, `undef1=undefined`, `num1=1` | The two exact lookups return their respective singleton sets. The block checks no ordering despite its enclosing heading. | Returning the shared nullish comparator group for either value includes the other key. |

The BTree file's opening infinite-loop and sentinel comments concern traversal;
they do not establish an equality law. `IndexInterface` exposes both lookup
methods, and the established direct-index tests distinguish nullish exact
values. The receiving oracle already states the separation between exact
membership and comparator position. This transfer is limited to direct index
methods. A live-query WHERE comparison with a nullish operand follows
three-valued logic, so it is outside this law.

## Receiving law and evidence to check

A plain source `Map` retains each key's exact value. The oracle recomputes
equality buckets without index normalization or comparator classification.
It drives each source action through BasicIndex and BTreeIndex and checks
`keyCount`, indexed keys, `equalityLookup`, and `lookup('eq')` after return.
Five fresh singleton or coexisting-add histories reconstruct the source cases;
an additional `null→undefined` singleton and fixed/random put/delete histories
challenge nearby legal transitions. The generated domain is three keys and
`undefined`, `null`, `1`, `2`. A direct update of an absent source key is
excluded; the driver uses `add` for that source action.

A skipped `undefined→null` update and a wrong `lookup('eq')` union are intended
to fail the model comparison. Both controls must reach the relevant method and
fail at the returned-action lookup assertion. The nullish scope does not imply
ordered, range, `IN`, live-query, bucket-identity, or instrumentation coverage.

## Execution and hostile review

The reviewed code head is `0d21a22ec56bc06a47776690d7cdbfded0ae9acc`.
The five ledger blocks were removed at that head; no other test block in either
source file was retired. The oracle and both remaining source files passed
411/411 targeted tests with zero type errors. The named replay manifest's
selector tests passed. Fixed seed `20261012` and a seedless campaign each run
the same nullish property with 100 histories per index type. Guarded replay at
seed `20261012`, path `0` selected only the BasicIndex and BTreeIndex random
lanes and recorded one completed 100-run witness for each.

The in-test skipped-update and unioned-lookup controls fail at the intended
Map-versus-lookup assertion. For replay failure fidelity, a temporary wrong
expected rule treated every `undefined` bucket as empty. It failed the
`equalityLookup(undefined)` comparison with seed `20261012`, shrink path
`0:1:1:1:1:1:0`, and counterexample `put(a, undefined)`. The guarded replay
reached one BasicIndex witness, marked it failed, and exited nonzero. After
restoring the oracle, that exact replay passed. This was a temporary model
fault for replay calibration, not a production mutant or a production bug.

The independent hostile reviewer `/root/review_nullish_membership` first found
that the new property lacked a checked replay manifest entry. That setup
failure was not counted as an oracle kill. The manifest entry, selector, and
async property reporter were repaired. The reviewer rechecked the committed
head after the commit hook and found no remaining semantic blocker. No
production defect was demonstrated, so production code did not change.

## Oracle guide audit at the reviewed head

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The established direct-index tests and `IndexInterface` exact-lookup methods supply the law. The claim excludes live-query WHERE nullish equality and the other observations listed above. |
| ORC-002 | A native source Map computes exact buckets without production normalization, comparator classification, or index storage. |
| ORC-003 | Opening prose states the law and limits; adjacent prose names the Map rule, legal actions, real index methods, observed sets, and returned-action checkpoint. |
| ORC-004 | Five fresh histories reconstruct the old witnesses; the adjacent `null→undefined` case and generated put/delete histories add nearby states. Removing either nullish value loses the distinguishing law; removing defined values loses defined/nullish moves; one key loses surviving-peer histories. The domain is three keys, four values, and at most 40 generated actions. An absent-key direct `update` is excluded because the source driver calls `add`. |
| ORC-005 | Both index types call real `add`, `update`, and `remove`, then compare exact returned sets and key count after each action. The fixed histories reach all five source states. |
| ORC-006 | A skipped `undefined→null` update and a unioned `lookup('eq')` result each cause an assertion failure at the exact-membership check. |
| ORC-007 | Fixed and seedless campaigns share one property, generator, recorder, comparison, and 100-run budget. The named guarded replay reaches the requested seed/path, and a captured controlled failure replays as a failed witness. |
| ORC-008 | The Map keeps key/value ownership because a later update or delete can distinguish sources with equal bucket sizes but different owners. |
| ORC-009 | `put` is a model source action mapped to index `add` or `update`; `delete` maps to `remove`. The shared terms `history`, `observation`, and `checkpoint` follow the glossary. |
| ORC-010 | The wrong-result spies restore in `finally`; the replay guard retains the failure witness separately from process status. No external resources are acquired. |
| ORC-011 | No plausible shared semantic fault requiring a second formulation was identified for the bounded nullish Map rule. Ordered comparator behavior is deliberately outside it. |
| ORC-012 | This record names the exact reviewed code head, audit result, controls, execution, and remaining scope. |
| ORC-013 | The `undefined→null` singleton and coexisting null/undefined adds distinguish no-op update and bucket-union alternatives at returned-action lookup checks. |
| ORC-014 | No controlled provider or host premise supports a claim about a real provider or host. |

The next nullish candidates need their own observations: ordered and cursor
reads, `IN` union, custom comparator arguments, and the public live-query
path. The remaining source tests continue to own their exact assertions until
those transfers pass the same gates.
