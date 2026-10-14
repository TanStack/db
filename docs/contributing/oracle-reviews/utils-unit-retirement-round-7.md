# Deep equality unit retirement: Date and RegExp

Two source-isolated Field Lab loss audits compared the Date and RegExp blocks
of `packages/db/tests/utils.test.ts` at frozen head `1265abeb5` with the
existing `utils-oracle.property.test.ts`. The proposed deletion said that the
oracle's copy/change and cross-type laws already covered both blocks. The
audits found three missing primitive boundaries before either block was
removed. No production behavior was changed for this transfer.

| Retired block and source observation | Frozen receiver | Receiving law and checkpoint |
| --- | --- | --- |
| Date: separately allocated 2023-01-01 Dates are equal; 2023-01-02 differs. | Date copy/change properties and a fixed Date-time triple covered the law, but not those exact operands. | The fixed 2023 triple reconstructs both results; the existing generated Date copy/change property checks neighboring timestamps at `deepEquals` return. |
| Date: a Date differs from its ISO string. | No Date/string pair; the broad cross-type description had compressed away this boundary. | A fixed 2023 probe and generated finite Dates compare with their own ISO text in both directions. |
| Date: a Date differs from its numeric timestamp. | No Date/number pair, even when the number encoded the same instant. | The same fixed and generated law compares with `getTime()` in both directions. |
| RegExp: separate `/abc/g` and `/test/i` copies are equal; changed flags or source differ. | Source/flags fixed triples and a generated copy/changed-flags property covered the law, but not those exact operands. | Fixed `/abc/g`, `/abc/i`, `/def/g`, and `/test/i` checks reconstruct each return; generated RegExps vary source and flags. |
| RegExp: `/abc/g` differs from its source string `abc`. | The receiver had RegExp/object and number/string pairs, but no RegExp/string pair. | A fixed source-text probe and generated RegExps compare with their own source text in both directions. |

The `deepEquals` documentation names Date and RegExp as supported value
classes. The old examples supply the more precise rule that their primitive
encodings are not coerced into those classes. The receiving model assigns
expected inequality from those distinct value classes; it does not call the
production classifier. The fixed operands preserve every old assertion, and
the generated properties extend each missing boundary across finite Dates and
valid RegExps. A deliberately coercing Date/number, Date/string, or
RegExp/string comparator fails the receiving checker at its forward inequality
assertion. Both directions are checked for the real production function.

The two legacy blocks contained six tests. After transfer, the focused oracle
and remaining unit file passed 208 tests with no type errors. The generator
uses finite Date timestamps from -1,000,000,000,000 through 2,000,000,000,000
milliseconds and the existing valid RegExp source/flag grammar; fixed and
seedless campaigns use the same properties. This establishes the direct
`deepEquals` return for those pairs. It does not establish cross-realm values,
RegExp subclasses, arbitrary prototype changes, every cross-type pair, or a
public change-event trace. Those need their own owner or receiving witness.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Existing `deepEquals` documentation and retained examples supply the class-preserving law; the direct value classes and return checkpoint are explicit. |
| ORC-002 | Separate constructors and primitive encodings determine expected copy, change, and cross-type outcomes without production classification. |
| ORC-003 | The receiver explains its law, bounded grammar, production call, and return comparison beside the checks. |
| ORC-004 | Every removed operand and outcome has a fixed reconstruction; generated finite Dates and RegExps vary the new cross-type boundaries. |
| ORC-005 | Each check calls exported `deepEquals` and observes the immediate boolean return. No public publication claim is made. |
| ORC-006 | Injected primitive-coercing comparators fail the exact inequality assertion for all three newly recovered boundaries. |
| ORC-007 | `utilsProperty` runs the same property with fixed and random seeds. The source/flags property replayed a captured failing seed/path directly, as recorded below. |
| ORC-008 | Not triggered: the value model has no mutable state. |
| ORC-009 | Date, RegExp, ISO text, epoch number, and source text are distinct value classes in this model; no production storage state is modeled. |
| ORC-010 | The direct check owns no cleanup resource; its assertion is the failure checkpoint. |
| ORC-011 | The source-isolated audits found a shared broad-category omission. The old exact examples and generated checks now enforce each primitive boundary; no independent second production formulation is claimed. |
| ORC-012 | This ledger records the source assertions, recovered losses, receiving checks, execution, limits, and pending exact-commit review. |
| ORC-013 | A primitive with matching displayed or numeric content distinguishes class-preserving equality from a plausible coercing design. |
| ORC-014 | Not triggered: the direct call has no provider or host boundary. |

## Exact-commit hostile review and follow-up

At committed head `c4c07da42`, the fresh reviewer confirmed that all six
retired assertions had fixed receiving witnesses and found no production bug
in this transfer. It found two broader oracle weaknesses: the generated
RegExp law varied flags but not source within a pair, and the two newly
registered cross-type properties had shifted existing ordinal replay IDs.
The generated source law now compares a same-flags, changed-source neighbor.
The two added properties are registered after the original properties, so
their old selectors retain their meanings. A focused run passed 139 oracle
tests with no type errors.

For ORC-007 calibration, a temporary wrong model rule expected an arbitrary
RegExp to equal its changed-source neighbor. The fixed campaign failed at the
`deepEquals` return comparison after one test with seed `20260911` and shrink
path `0:0`. Direct replay through `UTILS_ORACLE_PROPERTY=34`,
`UTILS_ORACLE_SEED=20260911`, and `UTILS_ORACLE_PATH=0:0` reproduced that
same assertion failure. Restoring the model rule made the direct replay pass.
The temporary rule is absent from the final oracle. This demonstrates replay
fidelity for the changed-source property, not every property in the file.

At `ae0b67fd2`, a fresh hostile reviewer confirmed all six retired assertions
and found no production mismatch in this transfer. It caught a replay defect:
the two new cross-type registrations preceded the existing RegExp, Float32Array,
and Duration registrations, shifting saved selectors 34–36. Moving the new
registrations after them restored 34 to RegExp source and flags, 35 to
Float32Array, and 36 to Duration; the new properties are 37 and 38. A temporary
wrong expected result for the RegExp changed-source neighbor failed on direct
replay of selector 34, seed `20260911`, path `0:0`, after one test at the
forward `deepEquals` return. Removing the temporary rule made that replay pass
with only the selected generated property active. Fresh review of the next
committed head remains pending.

At committed head `be5b7a3c4`, a fresh hostile reviewer found no blocker in
the six-test Date and RegExp transfer. All six retired assertions still have
fixed witnesses and broader generated laws. The owner passed 139 tests with
no type errors. Direct replays confirmed that selectors 34–38 name the
recorded properties, including selector 34 with seed `20260911` and path
`0:0`. The result covers direct `deepEquals` calls. It does not establish
public change events, cross-realm values, RegExp subclasses, or arbitrary
cross-type pairs. Ordinal selectors can shift if future registrations are
inserted ahead of them.

## Frozen-head ledger recheck

At `210651d207eefe9bbc025c780f6259e470225c9e`, the hostile reviewer
read the six retired Date/RegExp assertions, their source, the direct
`deepEquals` implementation, and the receiving oracle. Source inspection
found no missing operand or expected result in the bounded transfer. This
is a frozen-head no-loss verdict by inspection; it is not a new mutant kill
or a fresh committed-head execution of subsequent working-tree changes.

## Exact code-commit review of the narrowed transfer

At `24a61a8d5b6cef06d488c490e39f351b4d55fb68`, a fresh hostile reviewer
checked the committed six retired Date/RegExp assertions against their
fixed witnesses, generated laws, and production `deepEquals` path. It found
no loss at the direct-return checkpoint. The committed oracle and remaining
unit file passed 208 tests with no type errors. The scoped files and commit
check were clean. This verdict does not establish public change events or
cross-realm behavior.
