# Borrowed Date prototypes in indexed ranges

Scope update for PR #2116: the tests and contract claims described below are
historical. The current indexed range owner keeps ordinary local and
cross-realm Date source values and bounds, while borrowed prototypes,
subclasses, and overridden methods are outside its contract. See the
[coverage map](../oracle-coverage.md) for the active witness.

A Collection index may change the work used to answer a range predicate, but
it must not change the public key set. The live-query architecture requires a
range to fall back when indexed values do not share the bound's relational
domain. A native Date subclass has a Date timestamp even across JavaScript
realms; an ordinary object made with `Object.create(DateSubclass.prototype)`
does not. The latter cannot enter the index's Date range domain merely because
`instanceof Date` returns true.

The receiving owner is `packages/db/tests/query/index-path-collision-oracle.test.ts`.
Its finite model applies JavaScript numeric coercion to supplied Date values
and treats a throwing borrowed-prototype coercion as a nonmatch. The driver
compares public `currentStateAsChanges` keys before and after installing
BasicIndex or BTreeIndex. Its lookup spy and `optimizedOnly` read establish
whether the index is eligible. The source is a controlled, ready in-memory
Collection, so no provider or scheduling claim follows.

At `3668d1b88`, a hostile WHERE review found a public counterexample:
`gt(v, Date(1))` omitted a borrowed-prototype row in the unindexed snapshot
and included it after installing BasicIndex. The new oracle reproduces the
same result mismatch for both index types. A second history supplies the
borrowed object as a predicate bound; its scan result is empty, and an index
lookup would be unsafe. The positive control uses a genuine foreign Date
subclass and requires an optimized indexed result, so the repair cannot
disable all Date range optimization.

Production now uses the comparator's guarded native Date timestamp check when
it classifies an indexed value's domain and a range bound's eligibility. The
ordinary borrowed object therefore takes the scan path; native local and
foreign Dates remain eligible. The original code failed the after-index key
set, and the repaired focused oracle passes all 16 cases. The Date comparison owner
separately checks direct timestamp ordering and borrowed-object identity.

This witness covers the named `gt` and `lt` snapshots, two index types, one
local borrowed prototype, and one foreign native subclass. It does not prove
arbitrary coercion methods, invalid Dates, later publication histories,
other range operators, proxies, or provider reads. A fresh hostile review of
the committed repair is pending.

## Native timestamp law for subclass ranges

The frozen-head review at `210651d207eefe9bbc025c780f6259e470225c9e`
found a separate production defect. A genuine Date subclass can override
`valueOf` so native relational operators place it away from its actual
timestamp. The working-tree oracle uses a local and a foreign native subclass
whose overrides reverse their apparent positions. An independent model calls
the captured native `Date.prototype.getTime` and checks public scan results
for `gt`, `gte`, `lt`, and `lte` against a Date bound. The old relational scan
failed at this public key-set comparison. After the production repair, both
BasicIndex and BTreeIndex preserve those sets in ordinary and
`optimizedOnly` snapshots; lookup spies prove the indexed path is reached.
Four mixed Date/number scan predicates check both operand positions without
claiming mixed-domain index eligibility. The focused receiving run passed
132 tests.

This extends the range witness beyond the earlier borrowed-prototype `gt`
and `lt` histories. It covers one ready in-memory Collection, fixed rows,
four Date-bound operators, and both index types. Invalid Dates,
arbitrary coercion methods, later publication histories, provider cursors,
and generated subclass histories remain outside the evidence. A fresh
committed-head hostile review is pending.

Review of committed head `d974d4a4f` found that the misleading `valueOf`
subclasses were source values only. The fixed matrix now also uses a native
subclass as the predicate bound on both operand sides, where its override
returns a number opposite the native timestamp. Public scan and indexed
key sets still come from captured native `Date.prototype.getTime` values.
The focused owner passed 18 tests. This reaches the Date-bound compiler path;
it does not establish arbitrary coercion methods, generated subclass
histories, or other hosts. Fresh hostile review of the final committed
follow-up is pending.

## Read-only review of `0c236f448`

The hostile reviewer ran 18 focused cases and found a false-green reference
model. The earlier expected-key function called the native Date intrinsic on
source objects after those objects had entered the Collection. A source Date
changed after admission could therefore change the model's expected answer
along with production. A read-only probe demonstrated that risk; it did not
report a production range failure.

The model now freezes each source row's native timestamp before Collection
admission and derives every expected public key set from those numbers. A
post-check Date mutation confirms the recorded expectation stays fixed. The
subclass bound now reaches all four effective relations in both operand
positions; source values include local and foreign subclasses whose
`valueOf` disagrees with native `getTime`. Public scan and optimized indexed
snapshots still compare against the same frozen model. The focused owner
passes 18 tests after the change. This is a fixed in-memory matrix, not
evidence for later publication, other realms, arbitrary coercion, or provider
cursors. The new witnesses await hostile review at a committed head.

## Read-only review of `d917ba4c9`

The exact-head hostile review found an enforcement gap in the fixed Date-range
matrix. Its only source row at the bound's intrinsic timestamp was a plain
`Date`. A wrong comparator that sent a native subclass tied with the bound to
the strict side of a range could pass every subclass assertion: the local and
foreign subclass rows were previously below or above the bound. This was an
oracle-history gap, not a demonstrated production defect. The repair belongs
in the source-row grammar and exact-key comparison; changing the accepted
timestamp law or production comparator was not justified by this finding.

The working-tree owner now admits a local and a foreign native Date subclass
at the bound's exact millisecond timestamp. Their `valueOf` overrides report
`-100` and `100`, respectively, while the bound's native timestamp is `1`.
The model freezes all source timestamps through `Date.prototype.getTime`
before Collection admission. Thus `gt` and `lt` exclude all three tied rows,
while `gte` and `lte` include all three, including the plain-Date control.
The same exact expected key sets judge the unindexed scan, ordinary indexed
snapshot, and `optimizedOnly` indexed snapshot for BasicIndex and BTreeIndex;
the lookup spy confirms both indexed paths. A wrong-result control removes
`foreign-equal` from a real inclusive scan result and reaches the same
exact-key `toEqual` comparison, which rejects it as an assertion failure.
The focused Vitest run passed 18 tests with no type errors. These results are
working-tree evidence after the `d917ba4c9` review, not a fresh committed-head
hostile review.

### Oracle-guide applicability for this repair

| Requirement | Outcome at this working tree |
| --- | --- |
| ORC-001 | The live-query guide's comparison semantics promise native Date timestamp ordering, including foreign Dates; the owner limits its claim to fixed ready-Collection snapshots and the named Date domain. |
| ORC-002 | Expected keys come from native `getTime` numbers frozen before Collection admission and simple numeric relations; no production comparator or index classifier computes the reference. |
| ORC-003 | Opening prose states the law and limits. Adjacent comments identify the model, finite row and predicate grammar, Collection driver, public key observation, and scan/index checkpoints. |
| ORC-004 | Not triggered: this is a fixed bounded matrix, not a generated-history property. |
| ORC-005 | Public `currentStateAsChanges` keys are compared exactly before indexing and after BasicIndex or BTreeIndex installation; `optimizedOnly` and lookup spies witness the indexed path. |
| ORC-006 | Removing `foreign-equal` from a real `gte` scan result fails the exact-key assertion at its intended checkpoint. The control is an assertion failure, not a setup or runtime failure. |
| ORC-007 | Not triggered: the fixed matrix makes no important generated-property claim. |
| ORC-008 | Not triggered: the reference recomputes from frozen rows and introduces no stateful transition model. |
| ORC-009 | The reference maps plain, local-subclass, and foreign-subclass Date values to one intrinsic millisecond timestamp domain. The Collection retains the source values; the model intentionally does not represent their overridden coercion methods as ordering state. |
| ORC-010 | The owner's cleanup wrapper preserves a primary comparison failure as the `AggregateError` cause if release also fails; its separate cleanup witness checks both errors and release order. |
| ORC-011 | Not triggered by this review: the named fault was a missing tied-subclass history, not a plausible semantic error shared by production and the native-timestamp reference for which a second formulation was identified. |
| ORC-012 | This table records the other applicable requirements and explains non-applicable triggers. It does not substitute for a new exact-head hostile review. |
| ORC-013 | `local-equal` and `foreign-equal` reach the boundary premise. Inclusive and exclusive relations on both sides distinguish correct timestamp ties from a wrong strict-side rule; the wrong-result control rejects an omitted tie. |
| ORC-014 | Not triggered: the claim is limited to the controlled ready in-memory Collection and makes no real-provider or host handoff claim. |

The bounded claim remains: a ready in-memory Collection, fixed rows, these
four range operators and operand arrangements, two index types, and public
snapshot keys. Later publication, generated subclass histories, invalid Dates,
arbitrary coercion methods, provider cursors, and other hosts still need their
own witnesses before broader closure.

## Exact-commit review of `5c97f18dc`

A fresh read-only reviewer found no blocker in the tied-subclass Date-range
matrix. The frozen native timestamps predict strict exclusion and inclusive
inclusion of all three tied keys. Exact public key arrays, index lookup spies,
and the omitted-key wrong-result control reach the intended scan and indexed
checkpoints for both index types. The focused owner passed 18 tests with no
type errors. This verdict remains limited to ready in-memory snapshots and
the fixed rows, operators, and bounds described above.
