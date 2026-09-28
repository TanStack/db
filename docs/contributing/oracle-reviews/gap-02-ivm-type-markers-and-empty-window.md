# GAP-02: db-ivm type markers and empty-window moves

Reviewed executable revision: `a921e760` (parent `33a19494`, the fetched
`origin/main` at review time). This record and its changeset follow in a
documentation-only commit. The reviewed revision changes tests and the coverage
map. It does not change production code.

## Contract, path, and limits

The structural hash owns sampled distinctions between container kinds. For
each generated integer sequence, the test compares a Set or Map with a plain
object that has the same indexed entries. The independent expectation is that
the two container kinds produce different fingerprints in this sampled domain.
The test invokes `hash` through the native hash session and compares each pair
after hashing. A 32-bit hash can collide, so this is not an injectivity claim.

The fractional-index top-K operator reports a changed window through an empty
D2 output message when no relation rows move. The fixed history inserts one
row, retracts it, moves the requested window, and runs the graph. The test
checks the exact output-message suffix at that checkpoint. It does not run a
lazy source or establish that downstream acquisition starts.

## Grammar controls and calibration

The hash grammar generates one to five unique integers, including negative,
zero, and positive values. The same values construct both compared carriers.
The one-value `[[0]]` counterexample reconstructs the reported type-marker
fault for Set and Map. Unique values are necessary: duplicate Set values or
Map keys would make the indexed-object comparison cease to represent matching
entries. The carrier axis distinguishes Set from Map. Removing either carrier
would leave that type marker unchecked. Length one is the marginal case; the
generator also covers longer sequences. Empty carriers, duplicate entries, and
arbitrary object keys are outside this law. The fixed top-K history has no
generated grammar.

On unchanged production, the focused tests passed. A temporary hash mutant
replaced `hasher.update(marker)` with `hasher.update(0)` in `hashPlainObject`.
Both Set/object and Map/object properties failed in fixed and random campaigns.
The outcome class was **assertion failure**, not setup failure or timeout. The
fixed campaign reported seed `1659001`, path `0:0:0`, and minimized values
`[0]` for both carriers. Direct replay with
`TANSTACK_DB_IVM_HASH_TYPE_SEED=1659001` and
`TANSTACK_DB_IVM_HASH_TYPE_PATH=0:0:0` failed at the same comparison. Hash
initialization changes numeric fingerprints between processes, but the
counterexample and equality failure remain the same.

A temporary top-K mutant suppressed output when `TopKState.isEmpty` was true.
The fixed test reached its final assertion and received `[]` messages instead
of the required `[[]]`. Its outcome class was **assertion failure**. Both
production files were restored before the full green run.

## ORC-001 through ORC-012

| Requirement | Result                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ORC-001     | The hash owner's opening contract states fingerprint scope and collision limits. The top-K test names the empty-window report and its lazy-source motivation. The coverage map records both limits.                                  |
| ORC-002     | The hash expectation comes from equivalent indexed entries with different carrier kinds. The top-K expectation comes from the window-change report, without importing its change classifier.                                         |
| ORC-003     | The hash file shows the contract, generated values, relation, native driver, and comparison. The top-K addition is a focused regression beside the existing top-K relation owner.                                                    |
| ORC-004     | The hash grammar reconstruction, carrier ablation, value range, and duplicate-entry exclusion appear above. The top-K regression is fixed, so the generated-grammar trigger does not apply.                                          |
| ORC-005     | `hash` and `topKWithFractionalIndex` execute on production paths. The tests compare the hashes and exact D2 message suffix at their stated checkpoints.                                                                              |
| ORC-006     | Both named wrong designs failed by assertion at the intended checkpoints, as recorded above.                                                                                                                                         |
| ORC-007     | Each hash carrier runs the same property for 100 cases with fixed seed `1659001` and a random seed. The seed and shrink path select a direct replay. The property does not use `fc.commands`. The top-K regression is not generated. |
| ORC-008     | No stateful reference model changes.                                                                                                                                                                                                 |
| ORC-009     | No model-only terms combine or split glossary concepts.                                                                                                                                                                              |
| ORC-010     | The existing `HashReplayError` retains the law, input, observations, initialization tape, and original cause. The native fast-check report retains seed and path. Neither test acquires an external resource.                        |
| ORC-011     | No named shared semantic fault calls for a second formulation. The two carrier comparisons and hostile mutants calibrate the stated laws.                                                                                            |
| ORC-012     | This record ties the reviewed executable revision, the outcome classes, grammar controls, and limits to the coverage map.                                                                                                            |

## Verification

From `packages/db-ivm`, the package Vitest binary ran all 39 test files:
564 tests passed with no type errors. The package TypeScript check passed.
`git diff --check` passed. The package uses the normal full test campaign;
the four new hash campaigns run as part of that command. The test environment
used Node `v24.19.0`, Vitest `3.2.4`, and fast-check `3.23.2` on Darwin arm64.
