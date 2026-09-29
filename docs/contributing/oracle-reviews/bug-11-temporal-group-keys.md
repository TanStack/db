# Temporal group-key oracle review

## Reviewed state and contract

- Base: `33a194941c8d51f8f98babb999fef2987dd6ff8b` (`origin/main`).
- Reviewed executable head: `6d3e58ec`.
- Owner: `packages/db-ivm/tests/temporal-group-key-oracle.test.ts`.

The user confirmed that db-ivm `groupBy` must keep different Temporal values in
different groups. This repair uses db-ivm's established hash key domain: a
Temporal kind and its string representation identify a key. The oracle checks
the public grouped result after one input batch. It covers the eight Temporal
kinds recognized by hashing, with two different values and matching fresh
values for each kind. The model counts those descriptors in a plain Map.

The original serializer treated each Temporal value as an empty plain object.
On the base commit, a public `groupBy` of January 15 and June 15 PlainDates
emitted one group with count 2. The new oracle failed at that public checkpoint
for all eight kinds: it observed one count-2 group where it expected two
count-1 groups. Eight matching-value controls passed. A direct serialization
control also failed because a Temporal value and `{}` both encoded as `{}`.

The fix shares the existing Temporal discriminator with the serializer. The
serializer uses a tagged kind-and-value tuple for Temporal values at any
supported structural depth. The existing hash rule is unchanged. The repair
adds seven net production source lines; tests and contract records are separate.

## Oracle requirements

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass. The explicit user decision permits Temporal group keys. Existing db-ivm hashing defines the bounded kind-and-string domain. The oracle and coverage map name the one-batch checkpoint and exclusions. |
| ORC-002: independent judgment | Pass within that domain. A plain Map counts fixture values by Temporal kind and string. The model calls no db-ivm hash, serializer, or operator. The established hash domain is the separately justified semantic base; native `.equals()` is a distinct unresolved policy. |
| ORC-003: visible responsibilities | Pass. The opening states the law and limits. `temporalCases` is the bounded grammar, `expectedGroups` is the model, `observedGroups` drives public D2 `groupBy`, and the tests compare after `graph.run()`. |
| ORC-004: generated grammar controls | Not applicable. The oracle enumerates a fixed matrix; it does not claim generated-history coverage. Every listed kind runs distinct and matching cases. |
| ORC-005: path and observation | Pass. The driver imports the package entry point and observes every group output. It compares group identity and count. Its recorder keeps each emitted row; it cannot hide the one-group collision by overwriting a key in a Map. |
| ORC-006: checker calibration | Pass. The unchanged serializer was the plausible wrong design. It reached public `groupBy` and failed eight value assertions, not setup or timeout. The object control failed separately. |
| ORC-007: campaigns and replay | Not applicable. No important generated property is added. The fixed cases are individually named and directly runnable. |
| ORC-008: stateful-model minimality | Not applicable. Expected groups come from stateless recomputation of one batch. |
| ORC-009: vocabulary mapping | Pass. A fixture value is a db-ivm relation key inside a record. The model's descriptor combines the established Temporal kind and string identity; it is not a production hash or serialized key. |
| ORC-010: failure and cleanup | Not applicable. The in-memory graph has no acquired external resource or shrinker. The failing assertion preserves the observed group and checkpoint. |
| ORC-011: independent second formulation | The review identified native `Temporal.equals()` as a plausible different equality policy. No db-ivm contract selects it. The coverage map retains this exact decision; an `.equals()` oracle would impose new behavior outside this repair. |

This record supplies ORC-012 evidence for executable head `6d3e58ec`.

## Verification and remaining scope

The focused oracle changed from 9 failed and 8 passed tests on the base commit
to 17 passed on the repaired head. The full db-ivm suite passed 576 tests in
40 files. Package TypeScript, changed-file ESLint, Prettier, Vite build, and
`git diff --check` passed. Vitest ran with at most two threads.

The oracle does not cover incremental retractions. Symbols and cyclic keys
remain unsupported by the serializer. Mutable `RegExp.lastIndex` does not
belong to this Temporal law. An independent reviewer reproduced another
boundary: two ZonedDateTimes with `[UTC]` and `[Etc/UTC]` satisfy native
`.equals()` but have different kind-and-string keys. The coverage map records
the native-equality decision. This PR does not change that hash behavior.

## External-review follow-up on `f25fff0d3eeb655075ecc9743d693c541f7bf92d`

The review of PR #1919 found that the first oracle model classified inputs with
the same `Symbol.toStringTag` and `toString()` calls as production. This could
hide a collision between a real Temporal value and a plain object with a
spoofed tag. On starting head `c08a3201b3cf166ac25494302ea92ea1d8b2bcb6`,
a plain object with an own `Temporal.PlainDate` tag, a non-enumerable date-like
`toString()`, and an `extra` property entered the Temporal branch. Public
`groupBy` emitted one count-2 group for that object and a genuine PlainDate.
The new oracle case failed at the group-count assertion: expected two groups,
observed one. The original model would have expected that one group too.

The follow-up model counts fixture-assigned identity classes. It no longer calls
`Symbol.toStringTag` or `toString()` to derive expected groups. The detector now
requires the accepted tag to exist on the input's prototype. The same oracle
case passes, and a second case proves that a genuine Temporal value with its
own matching tag still joins its matching group. This check prevents the
original plain-object collision without treating a matching own tag as proof of
Temporal identity. The entire db-ivm suite passed: 578 tests in 40 files.
TypeScript, changed-file ESLint, Prettier, Vite build, and diff checks passed.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001 | The law remains two distinct group-key identities and one matching identity after one batch. The established kind-and-string domain stays the authority. |
| ORC-002 | Fixture labels define expected classes. The model does not use the production Temporal classifier. |
| ORC-003 | The opening contract, `temporalCases`, `expectedGroupCounts`, `observedGroupCounts`, and assertions expose the five oracle responsibilities. |
| ORC-004 | Not applicable: the finite Temporal-kind matrix is not a generated property. |
| ORC-005 | The public `groupBy` output supplies group counts after `graph.run()`. The recorder also checks positive weights and unique emitted keys. |
| ORC-006 | The original detector survived the old classifier but failed the new spoofed-object case at the public group-count checkpoint. The repaired detector passed the same case. |
| ORC-007 | Not applicable: no generated property or replay campaign changed. |
| ORC-008 | Not applicable: the reference counts one stateless input batch. |
| ORC-009 | Fixture labels represent expected group-key identity classes. They do not represent a production hash or serialized key. |
| ORC-010 | Not applicable: the in-memory graph has no acquired resource or shrinking path. |
| ORC-011 | The fixture-label formulation is independent of the kind-and-string classifier. It rejects the named shared fault. |
| ORC-012 | This addendum records each applicable requirement for the exact follow-up head. |

The current detector still accepts a custom prototype that advertises a
Temporal tag and supplies a matching `toString()` method. A direct probe found
that such an object still serializes to the same key as a genuine PlainDate.
The coverage map owns that remaining counterfeit-prototype witness and the
native/polyfill brand decision. No claim of complete spoofing resistance follows
from this change. Also, `Temporal.Duration.compare(PT1H, PT60M)` returns zero,
but `groupBy` emits two count-1 groups under the established string-key domain.
The coverage map retains that equality-policy decision with the ZonedDateTime
alias example.

## Second review on `b9b59c089dd574b5eed7672a66b6768808837919`

The second review challenged the remaining custom-prototype case named in the
coverage map. A plain object can inherit a `Temporal.PlainDate` tag and a
matching `toString()` from a custom prototype. With an own `extra: 1` field,
this object is a supported structural value distinct from a genuine PlainDate.
The current public `groupBy` merged those two rows. A new primary-oracle case
failed at `graph.run()`: expected group counts `[1, 1]`, observed `[2]`.
This is an in-scope counterexample to the plain-object versus Temporal group-key
identity law. It keeps the broader tag-spoofing class open. The RED case remains
local and uncommitted while the compatibility policy is undecided; the PR must
not gain an active failing test without its repair.

A trusted brand method can distinguish this counterfeit. The local
`temporal-polyfill` `PlainDate.prototype.toString.call(value)` rejects it.
Node 24's native Temporal method also rejects it. Under `--harmony-temporal`,
the native method accepts genuine values from a separate VM realm for all eight
recognized Temporal kinds. The local polyfill method rejects a genuine
PlainDate from a separately loaded polyfill copy with `TypeError: Invalid
calling context`. Current `groupBy` accepts that cross-copy value and merges
it with a same-value local polyfill PlainDate into one count-2 group. Thus a
local-polyfill-only brand gate would break an observed public behavior.

The smallest policy-dependent options are:

1. Trust the runtime's native Temporal constructors and one imported
   `temporal-polyfill` copy. Call each trusted prototype method on the input.
   This preserves native cross-realm and local-polyfill values. It cannot
   authenticate a separately loaded foreign polyfill copy. Treating that copy
   as an ordinary object could merge distinct foreign dates with no enumerable
   fields, so this option needs a declared unsupported boundary or an error.
   It also needs a runtime polyfill dependency and roughly 15–25 additional
   production lines before simplification. The final count needs the diff.
2. Add a trusted registration path for other polyfill copies. A registered
   constructor supplies its brand-checking prototype method. This can preserve
   cross-copy grouping after registration, but requires a new public capability
   and an explicit decision about unregistered values. The extra registry,
   lifecycle, and API need more production code than option 1.
3. Fail immediately for untrusted Temporal-like inputs. This prevents a silent
   collision, but it rejects valid plain objects that advertise a Temporal tag
   and does not preserve existing cross-copy grouping.

Reading a constructor or method from the candidate object is not a sound brand
check: a counterfeit can supply both. JavaScript exposes no generic Temporal
internal-slot check that accepts arbitrary independent polyfill copies without
a trusted intrinsic or registration. The user is deciding whether separately
loaded polyfill copies must remain supported. Until that decision, this review
item is `confirmed-open`; no production change, changeset, PR-body update, or
push follows from this review. Production-code weight for this second review is
zero. The Duration alias-equivalence decision remains separate and unchanged.

Reviewer assessment for this second finding: technically accurate and high
signal. It reached the public boundary and named a residual case that the
coverage map already owned. The request for a sound cross-realm brand check
exposes a real compatibility choice, so the proposed fix is incomplete until
that choice is made. This review sample supports a positive reviewer
recommendation, with the policy dependency stated explicitly.

## Full rereview: own-only Temporal tag on `b9b59c089dd574b5eed7672a66b6768808837919`

R19-4 proposed that a genuine Temporal value with only an own
`Symbol.toStringTag` would fail the current prototype-tag gate. This state does
not arise from ordinary native or `temporal-polyfill` construction. It is still
reachable through legal JavaScript operations. For both implementations, the
probe created two equal `PlainDate` values, added an own matching tag to one,
then moved that value to `Object.prototype`. It installed the implementation's
intrinsic `toString` method as a non-enumerable own property. The intrinsic
still returned `2024-01-15` for the changed value, proving that its Temporal
brand survived the prototype change.

An own matching tag with the original prototype remained recognized by
`isTemporal`. With the changed prototype, `isTemporal` returned false and
`serializeValue` produced `{}` instead of the genuine date's Temporal key.
Public `groupBy` emitted two count-1 groups for the equal dates, while the
fixture-defined Temporal identity law expects one count-2 group. The same
result occurred with the local polyfill and Node 24 native Temporal under
`--harmony-temporal`. The claim is technically true for a valid, uncommon
operation. The current contract says Temporal values are valid group keys and
does not exclude prototype changes. The broader trusted-brand decision from
the second review also owns this case. No stricter gate or RED test is pushed
while the user decides the supported cross-copy polyfill domain.

The rereview also called `PT1H` versus `PT60M` separation "by-design." That
phrase describes the existing kind-and-string key rule, but it overstates the
alias policy. The coverage map explicitly says whether equal-comparing
Durations should coalesce needs a separate contract decision. The first review
record makes the same distinction. Therefore the current behavior is documented,
but the alias-equivalence policy is open. This review does not change it.

Full-rereview ledger: two source claims. R19-4 is `confirmed-open` with the
public groupBy probe above. The Duration wording is a `design-decision` with
its destination in the Temporal group-key coverage map. Neither item caused a
production edit, test commit, PR-body change, or push. Production-code weight
for this rereview is zero. Reviewer assessment: R19-4 identified a real but
uncommon legal state, while the "by-design" summary was too strong. The
technical signal is good; the review should keep documented behavior separate
from an approved product decision.

## Product scope decision

The maintainer chose ordinary native Temporal values or one polyfill copy as
the supported group-key inputs. Code that replaces a Temporal prototype or
creates a custom prototype that impersonates Temporal is outside this contract.
Separately loaded polyfill copies are also outside it. The RED probes above
remain evidence of those behaviors; they do not establish an in-scope product
bug under the chosen domain. The active oracle keeps its ordinary own-tag
plain-object control and does not include a failing altered-prototype case.

The maintainer also chose to keep alternate representations separate.
`PT1H` and `PT60M` therefore remain separate groups even though
`Temporal.Duration.compare()` returns zero. This follows the established
kind-and-string key rule. The coverage map and oracle opening now state both
decisions. No production code or new runtime dependency is needed.

The updated oracle checks a `PT1H`/`PT60M` pair at the public `groupBy`
checkpoint. The 20 Temporal oracle tests and db-ivm TypeScript check pass.
