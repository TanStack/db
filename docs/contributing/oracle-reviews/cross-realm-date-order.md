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
equal times, and invalid values are legal. A fixed cross-family case also
checks that numeric NaN and either local or foreign invalid Date compare at
exactly one order position. A forged `[Symbol.toStringTag] = 'Date'` object is
a negative control: neither the classifier nor the normalizer accepts it as a
Date, and the comparator does not tie it to a Date. Proxies, subclasses,
other value classes, cursor pagination, and other realm mechanisms remain
outside the bounded grammar.

## Repair, GREEN evidence, and hostile review

`dateTimestamp` now recognizes a native Date created in another realm and
reads its timestamp with `Date.prototype.getTime.call`. A string tag alone
cannot establish the native Date brand: a forged tag must fail that intrinsic
call. Local Dates use the same intrinsic, so an own `getTime` method cannot
silently replace the timestamp. `ascComparator` classifies each operand once,
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
and forged-tag controls complement generated realm/time pairs (ORC-004, -013).
Direct classifier, comparator, and normalization checks compare at function
return; a public ordered scan compares after preload (ORC-005). The original
production fails both a direct and public-row observation, supplying an actual
wrong implementation rather than only a hypothetical mutant (ORC-006).
The shared property harness runs fixed-seed and seedless campaigns and supports
seed/path replay (ORC-007). The scan cleans up its source and live-query
Collections in `finally` (ORC-010). There is no stateful model or external
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

Pending commit and fresh reviewer recheck.
