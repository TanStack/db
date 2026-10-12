# Index unit retirement: exact and IN membership

The source-isolated Field Lab loss audits used `b56d1a45c` as the frozen
baseline. The receiving owner is
`packages/db/tests/index-update-oracle.property.test.ts`. Its prior nullish
Map law checked `equalityLookup` and `lookup('eq')`, but explicitly excluded
`IN`. The four legacy blocks below remain in the source file until the new
checks and hostile review pass.

## Transfer ledger before retirement

| Legacy block in `btree-index-undefined-values.test.ts` | Smallest source history and returned-add observation | Plausible wrong result | Receiving witness |
| --- | --- | --- | --- |
| `should find items with undefined indexed value` | Add `a=active`, `b=undefined`, `c=inactive`, `d=undefined` on `status`; `equalityLookup(undefined)={b,d}`. | A lookup drops one of the two owners or includes a string peer. | The fixed four-add string history computes every exact set from a source Map after each add. |
| `should return empty set when no undefined values exist` | Add `a=1`, `b=2`; `equalityLookup(undefined)=∅` in a nonempty index. | A missing-bucket fallback returns a defined key. | The fixed all-defined history reads the absent group after both adds. |
| `should handle undefined in inArrayLookup` | Add `undef=undefined`, `one=1`, `two=2`, `three=3`; `inArrayLookup([undefined,1])={undef,one}`. | The method ignores the undefined operand, returns only one group, or includes a distractor. | The fixed four-add history and mixed-list probe compare the full set from the Map. |
| `should handle inArrayLookup with only undefined` | Add `undef1=undefined`, `undef2=undefined`, `one=1`; `inArrayLookup([undefined])={undef1,undef2}`. | An undefined-only list returns empty or loses one owner. | The fixed three-add history and singleton-list probe compare the full set from the Map. |

The `IndexInterface` exposes direct exact and `IN` methods. A source Map owns
keys and values; equality selects one exact-value group, while `IN` selects
keys whose source value occurs in its operand list. The expectation does not
call either production lookup, normalized-key helper, or comparator. The
driver checks both direct methods and `lookup('eq')`/`lookup('in')` for
BasicIndex and BTreeIndex after each source action returns. A generated
three-key, five-value put/delete grammar checks nearby transitions with empty,
repeated, both orders of a mixed list, and nullish-only operand lists. The fixed four-key and string
histories preserve source distinctions outside that generated domain.

This is a direct-index set-selection law. It does not specify live-query WHERE
or `IN` nullish semantics, ordered traversal, range lookup, bucket identity,
or instrumentation. The `index-update-short-circuit.test.ts` block that also
calls `lookup('in')` stays: its `performance.now` non-call assertion cannot be
observed by this result oracle. The BTree file's traversal, range, custom
comparator, storage, and live-query blocks also stay.

## Execution and hostile review

The four ledger blocks were removed; the BTree file now has 12 tests instead
of 16. The receiving oracle, the remaining BTree file, and the short-circuit
file passed together: 423/423 tests and no type errors. The receiving oracle's
fixed-seed and seedless campaigns use the same 100-run property for each index
type. The guarded replay for `index-update.nullish-membership` at seed
`20261012`, path `0` reached two executions, one per index type, with 100 runs
each. The named replay manifest checks passed.

The in-test wrong-result controls make a lookup lose one undefined owner,
drop the trailing undefined operand in `[1, undefined]`, lose one owner from
`[undefined]`, and return only the first group through `lookup('in')`. Each
reaches the relevant method and fails the Map comparison. The earlier
skipped-update and unioned-equality controls still pass their calibration.

For failure replay, a temporary wrong expected rule cleared the Map result
for `[undefined, 1]`. The random lane failed at the direct `inArrayLookup`
comparison on `put(a, undefined)` with seed `20261012` and shrink path
`0:1:0:1:1:1:1:0`. Guarded replay reached both index lanes, recorded a failed
one-run witness for each, and exited nonzero. After removing the temporary
fault, that exact replay passed both lanes. This was a model fault for checker
and replay calibration, not a production mutant or a production defect.

The fresh hostile reviewer `/root/review_in_membership` inspected the source
blocks, production implementations, ledger, oracle, and coverage map. It found
a position-sensitive survivor: all original mixed probes had undefined first.
Adding `[1, undefined]` and a control that drops its trailing undefined
operand killed that survivor. The reviewer independently ran the nullish
membership slice (36 passed, no type errors) and found no remaining semantic
blocker to retiring the four named blocks. It did not run a production mutant.
No production change was justified by this round.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | `IndexInterface` and the established direct-index tests supply exact and `IN` set-selection obligations. The claim excludes WHERE semantics, ordered and range reads, bucket identity, timing, and arbitrary JavaScript values. |
| ORC-002 | A source Map supplies ownership. Expected exact sets come from Map grouping; expected `IN` sets come from operand membership over source rows. Neither uses production normalization, comparator classification, or another production lookup. |
| ORC-003 | Prose beside the model names the law, grammar, direct index driver, returned sets, and after-action checkpoint. |
| ORC-004 | The four fixed histories reconstruct every retired source state and operand. The generated grammar has three keys, five numeric/nullish values, up to 40 put/delete actions, and empty, repeated, mixed, reversed-mixed, and nullish-only lists. The fixed string and four-key histories cover values and width outside that grammar. Removing undefined loses the reported case; removing null loses nullish distinction; removing defined values loses mixed selection and moves; one key loses peer retention. Direct update of an absent source key is excluded. |
| ORC-005 | Both real index classes execute `add`, `update`, and `remove`. The checker compares `equalityLookup`, `lookup('eq')`, `inArrayLookup`, `lookup('in')`, key count, and indexed keys after each action returns. |
| ORC-006 | Four new wrong-result controls fail at the intended comparison; the temporary wrong expected rule also fails the generated `IN` comparison. No production mutant was run. |
| ORC-007 | Fixed and seedless campaigns share one generator and check with 100 runs each per type. Guarded seed/path `0` replay reached both lanes; the captured `0:1:0:1:1:1:1:0` failure replayed as failed, then passed after restoration. |
| ORC-008 | The Map retains each key's value because a later update or delete can distinguish states with the same bucket sizes but different owners. No model state was removed. |
| ORC-009 | `put` maps to index `add` or `update` according to source ownership; `delete` maps to `remove`. `IN` operands are lists of source values, and the after-action comparison is the checkpoint. |
| ORC-010 | Wrong-result spies restore in `finally`. Guarded replay records the property failure separately from child exit and cleans its temporary witness channel. The temporary model fault was removed after replay. |
| ORC-011 | No plausible shared semantic fault requiring a second independent formulation was identified for this bounded primitive-value Map rule. The review's order-sensitive survivor was an enforcement gap and is now checked. |
| ORC-012 | This versioned ledger records source assertions, law limits, execution, hostile review, and remaining scope. The committed code head is identified in the postcommit review addendum. |
| ORC-013 | `[undefined, 1]` versus `[1, undefined]` distinguishes operand-order dependence; `[undefined]` with two owners rejects first-owner-only selection; `[]` and `[1, 1]` check empty and duplicate boundaries. The wrong-result controls fail at returned-set comparisons. |
| ORC-014 | No controlled provider or host premise is used to claim real-provider or host behavior. |

The remaining legacy blocks keep their distinct observations. The
short-circuit timing assertion, BTree traversal and range behavior, custom
comparator arguments, storage representation, and public live-query result
still need their own owners before retirement.
