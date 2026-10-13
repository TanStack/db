# Date order across JavaScript realms

The comparison loss audit led to a same-realm NaN/invalid-Date transfer. A
fresh hostile review then challenged the whole published Date ordering law,
including native Dates created in another JavaScript realm. The live-query
guide's comparison section and changelog #1582 promise that invalid Dates act
like NaN in ordering and equality, without a realm exception. A valid Date
orders by timestamp. This is a product-law question beyond the five retired
same-realm examples, so it has its own witness and review.

At unchanged production head `175adce0cb32e29e5838853c821ee5c56fe0089a`,
`ascComparator(foreign Jan 2, local Jan 1)` returned a negative sign rather
than positive. The new tagged Date oracle constructed local and `node:vm`
Dates from model timestamps and compared both operand orders, then checked
`normalizeValue` against the supplied timestamp. The fixed valid-Date case
failed at the direct comparator sign. The fixed-seed generated campaign failed
normalization at seed `20260911`, path `0:0:1` and directly reproduced that
checkpoint; the seedless campaign likewise failed and replayed. These are
product mismatches, not setup or cleanup failures.

A separate public ordered-scan witness inserted an invalid Date before a valid
Date in a Collection with `autoIndex: 'off'`. The local invalid-Date control
returned IDs `[2,1]`; the foreign invalid-Date case returned `[1,2]`, failing
the same exact public-row comparison. The source Collection and live query
cleaned up in `finally`.

The model uses `null` only as an invalid-Date *tag*: production receives a
native Date with a NaN timestamp. Valid tags range from -1e12 to +1e12 epoch
milliseconds. Both local and foreign constructors, both argument positions,
equal times, invalid values, and an own display tag are legal. One fixed
control changes the foreign Date prototype's display tag. Another checks that
numeric NaN and either local or foreign
invalid Date compare at exactly one order position. A forged
`[Symbol.toStringTag] = 'Date'` ordinary object is a negative control: neither
the classifier nor the normalizer accepts it as a Date, and the comparator
does not tie it to a Date. Proxies, subclasses, other value classes, cursor
pagination, and other realm mechanisms remain outside the bounded grammar.

## Repair, GREEN evidence, and hostile review

`dateTimestamp` now recognizes a native Date created in another realm and
reads its timestamp with `Date.prototype.getTime.call`. A fast shape gate
avoids a caught exception for ordinary objects and Temporal values. For an
object with a display tag, it checks the immediate prototype's own `getTime`
descriptor without reading the tag. The intrinsic remains the final brand
check, so a forged tag cannot establish Date identity, while an own or
prototype display tag cannot hide a normal Date. Local Dates use the same
intrinsic, so an own `getTime` method cannot silently replace the timestamp.
`ascComparator` classifies each operand once,
uses its timestamp for valid Date order, and treats an invalid Date like NaN.
`isUnorderable` and `normalizeValue` use the same timestamp extraction.

After the repair, the comparison oracle, remaining comparison unit tests,
direct index oracle, and selected integration test passed 514 tests with no
type errors. The direct Date property ran with the fixed seed and the ordinary
seedless campaign. Its equal-timestamp branch forces ties independently of a
random collision. The new classifier assertions, both comparator directions,
and exact normalization diagnostics compare against supplied model tags. The
public scan checks complete ordered IDs after `preload()`; the local control
ensures this query path actually sorts before the foreign case is judged.

The fresh hostile reviewer `/root/review_realm_date_oracle` followed the law
to the live-query guide and changelog #1582, inspected the unchanged-head RED
results, challenged model independence and a forged Date tag, and found no
blocker for this bounded repair. It identified the mixed NaN/invalid-Date
gap; the exact cross-family control now covers that comparison. It also found
that repeated Date classification could reread an unrelated object's tag;
the comparator now extracts each timestamp once per operand. A final
committed-head review follows below.

## Oracle guide audit and limits

The guide's law, authority, and scope requirements (ORC-001, -003, -011)
are stated in the oracle opening and beside this tagged Date model. Supplied
timestamps and invalidity tags predict order without production classification
(ORC-002, -009). Fixed foreign-valid, foreign-invalid, equal-time, mixed-NaN,
tagged-Date, and forged-tag controls complement generated realm/time/tag pairs
(ORC-004, -013).
Direct classifier, comparator, and normalization checks compare at function
return; a public ordered scan compares after preload (ORC-005). The original
production fails both a direct and public-row observation, supplying an actual
wrong implementation rather than only a hypothetical mutant (ORC-006).
The shared property harness runs fixed-seed and seedless campaigns and supports
seed/path replay (ORC-007). The scan uses `withOracleCleanup` to attempt both
Collection cleanups and preserve the primary mismatch (ORC-010). There is no stateful model or external
provider in this lane (ORC-008, -014). This record preserves the exact RED
head, reviewer verdict, and bounded GREEN result (ORC-012).

`normalizeValue` is an internal index-key diagnostic, not public equality
evidence. The separate
[WHERE publication witness](cross-realm-date-where-publication.md) checks
public Date equality and explicit BasicIndex equality lookup. This record's
public scan uses `autoIndex: 'off'`; indexed order, range WHERE paths,
cursor/provider continuation, and other Date-consuming paths need separate
witnesses before they enter this closure claim. The subsystem has
realm-sensitive `instanceof Date` checks outside the three repaired utilities.
This record does not infer their correctness from the unindexed scan.

## Exact committed-head recheck

At published commit `9a145fba130f27c914a4a1fd4f44c5871a917483`, the fresh
hostile reviewer `/root/exact_review_comparison_round5` found a reachable
counterexample to the native-Date claim. A foreign native Date with an own
`Symbol.toStringTag = 'Other'` still passes `Date.prototype.getTime.call`, but
the production detector used `Object.prototype.toString` and treated it as an
ordinary object. The reviewer executed a public ordered query with a foreign
invalid Date carrying that tag. It returned IDs `[1,2]` instead of `[2,1]`.
The reviewer also observed that `isUnorderable` read an unrelated object's
display-tag getter. The existing oracle had plain foreign Dates and a forged
ordinary object, but no genuine Date whose tag differed.

The expanded fixed controls and generated tag axis failed against that
published implementation. The focused RED run reported five failures: the
unrelated getter-count control, tagged-Date normalization, both generated
campaigns, and the public ordered scan. The fixed campaign captured seed
`20260911`, shrink path `0:0:0`, at the function-return checkpoint. The guarded
intrinsic detector passed the focused Date suite: seven tests and no type
errors. The public scan now includes the tagged foreign invalid Date. Fixed
controls also cover a genuine foreign Date with a misleading Temporal tag, a
tag getter that must not run, and an altered foreign Date prototype tag.

The reviewer also found a harness risk by source inspection. A rejected
`query.cleanup()` in the original `finally` block could replace the ordered-ID
mismatch and skip `source.cleanup()`. The scan now uses the repository's
failure-preserving `withOracleCleanup` helper. A fresh review of the next
committed head remains pending.

An intermediate intrinsic-only repair threw and caught for every ordinary
object and Temporal comparison. Hostile microbenchmarks found a substantial
Temporal cost. The final shape gate avoids that hot path without trusting tag
text as a Date brand. Dates with a replaced or stripped Date prototype, Date
subclasses, and proxies remain outside this claim.

At clean commit `636e71e3d6084da6badeb0055fef5aae19ca4f58`, the fresh
hostile reviewer `/root/exact_review_comparison_round5` found no blocker for
the declared Date and retired-test scope. The focused suite passed 103 tests
with no type errors. The reviewer checked that genuine tagged foreign Dates
retain timestamp semantics, forged ordinary objects fail the native brand
check, unrelated display-tag getters remain unread, and the comparator avoids
the rejected exception-heavy path for Temporal values. The public scan cleanup
preserves a primary mismatch if cleanup also fails. This verdict does not
extend to replaced Date prototypes or `getTime` methods, proxies, subclasses,
indexed order, range queries, or cursor continuation.

## Tagged Date subclass follow-up

At `ae0b67fd2`, a new hostile review found a native `node:vm` Date subclass
with an own display tag that the immediate-prototype `getTime` descriptor gate
rejected. The native intrinsic returned timestamp 123, yet normalization left
the object unchanged and a public `eq` query missed its row. This is a separate
product bug under the guide's native-Date timestamp law, not a lost assertion
from the five retired same-realm blocks. The comparison owner now fixes local
and foreign subclasses with an inherited Date method, valid and invalid
timestamps, direct normalization and order, and an ordinary object borrowing
the foreign subclass prototype. On the original code the direct witness failed
at `normalizeValue(foreignSubclass)`, returning the object instead of 123. The
repair walks prototype descriptors without reading user getters, then calls
the native `Date.prototype.getTime` as the final brand check. Both receiving
oracles passed 127 focused tests after the repair. The separate WHERE owner
records the public RED and GREEN observations. Proxies, deeper subclass chains,
replaced methods or prototypes, indexed order, ranges, and cursor continuation
remain unproved. Fresh exact-commit review of this follow-up remains pending.
