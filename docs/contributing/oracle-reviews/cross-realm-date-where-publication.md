# Cross-realm Date equality at WHERE publication

The [comparison transfer ledger](comparison-unit-retirement-round-5.md)
retired five same-realm NaN and invalid-Date examples. A hostile review of
their receiving law found a different defect: a native Date created in another
JavaScript realm was not normalized to its timestamp. The
[ordering record](cross-realm-date-order.md) preserves direct and public scan
RED witnesses. This record tests the separate equality and publication path.
It does not retire another unit test.

The live-query guide now states explicitly that native valid Dates compare by
timestamp across realms and display tags. Changelog #1582 covers the separate
invalid-Date/NaN equality class. The WHERE publication owner already models
these classes for local values. Its focused matrix tags each source value and
literal as a local or `node:vm` Date with timestamp 1, timestamp 2, or an
invalid timestamp, or as number 1 or NaN. Some foreign Dates have an own
display tag. The model reduces tags to equality classes before production
values exist. It predicts complete, sorted public key sets, independent of
`normalizeValue`, the evaluator, or either index implementation.

The driver starts a source Collection with auto-indexing off, then exercises
both no-index and explicit BasicIndex modes. At each mode and literal it
compares public live-query Collection keys, filtered source subscriber keys,
and direct Collection snapshot keys after preload. The indexed mode also
compares `BasicIndex.lookup('eq')` and a public snapshot with
`optimizedOnly: true`; that snapshot cannot silently use the scan fallback.
One sync transaction moves four source rows across equality classes, and the
same checks run after commit. The test does not prove that the public live
query planner selected the index. The source and live-query Collections and
subscription are released through the owner's cleanup helper.

## RED and GREEN evidence

An isolated archive of unchanged head
`175adce0cb32e29e5838853c821ee5c56fe0089a` ran the new test without
swapping production files in the shared worktree. It failed at the intended
unindexed public live-query comparison: `eq(v, local Date(1))` expected keys
`[foreign-one, local-one, number-one]` and returned
`[local-one, number-one]`. The cross-realm premise itself passed: the foreign
value failed local `instanceof Date` but was accepted by the native Date
intrinsic. This is a product result mismatch at a public checkpoint.

With the comparison utility repair, the complete WHERE publication oracle
passed 18 tests with no type errors. The DB oracle suite passed 5,006 tests
across 73 files with no type errors. At that first repair, the scope was native
local and `node:vm` Dates, finite timestamps 1 and 2, invalid Dates and NaN,
one three-row sync transaction, and the named observations. Other realm hosts,
proxies, subclasses, spoofed tags, arbitrary timestamp histories, and
planner proof of live-query index selection remain outside this witness.

The full DB suite initially reported two failures in the existing
`subset-dedupe.test.ts` Date transport test. It expected local `Date(2)` and
foreign `Date(2)` to match different `eq` and `in` requests. That assertion
encoded the old realm-local implementation, contrary to timestamp equality.
The test now expects both Dates to match for either literal realm and directly
checks that the request object is passed through unchanged. Its separate
Uint8Array realm observations remain untouched. The focused subset-dedupe and
WHERE files then passed 53 tests with no type errors; the full
`@tanstack/db` test command also passed.

## Oracle guide audit and hostile review

The opening prose and adjacent comments state the equality law, model,
bounded grammar, production driver, public observations, and two checkpoints
(ORC-001 through -005, -009). The original implementation fails a public
comparison at the intended cut; `optimizedOnly: true` is a positive indexed
snapshot reach witness, although its frozen-head RED was not separately run
(ORC-006). This is a fixed matrix rather than a generated campaign; all
declared cells run on every execution, so seed/path replay is inapplicable
(ORC-004, -007). The model's source rows change only after a committed
transaction, and all consumers compare with that same authored state
(ORC-008). The cleanup helper preserves the primary failure while releasing
consumers (ORC-010). The comparison transfer and ordering records identify
the original test gap and rival identity-versus-timestamp rule (ORC-011
through -013). The sync source is controlled; the witness makes no provider
claim (ORC-014).

The fresh hostile reviewer `/root/review_realm_date_where` inspected the
model, the original unit ledger, current production, public authority, and
both lanes. It found one reach gap: direct index lookup did not prove a public
read used the index. The added optimized-only public snapshot closes that
gap. Its final verdict found no blocker for the bounded matrix. The reviewer
also traced the full-suite failure above to the old test's realm-specific
assumption, not to a request-identity contract. Final key sets do not prove
subscriber event multiplicity, payloads, or intermediate publication.

## Exact committed-head recheck

At published commit `9a145fba130f27c914a4a1fd4f44c5871a917483`, the fresh
hostile reviewer `/root/exact_review_where_realm` found no blocker in the
bounded matrix for unmodified native Dates. The focused WHERE and subset suites
passed 53 tests with no type errors. Source inspection confirmed that the
`optimizedOnly: true` read cannot fall back to a scan.

The same reviewer independently found the foreign native Date with an own
`Symbol.toStringTag`. The published comparison utility classified it by object
identity, so the broader native-Date claim was open. The matrix now includes
tagged foreign source rows, tagged literals, and a tagged post-commit update.
The reviewer ran this expanded matrix in an isolated archive of `9a145fba1`.
At its first unindexed public live-query checkpoint, a local `Date(1)` literal
expected `foreign-tagged-one` in the key set, but production omitted it. The
complete expected set was `[foreign-one, foreign-tagged-one, local-one,
number-one]`; production returned `[foreign-one, local-one, number-one]`.
Vitest reported an assertion failure with no type errors. The unmodified
matrix passed against the same archived code. After the guarded intrinsic
repair, the expanded matrix passed in both indexed and unindexed modes. A
fresh committed-head review of the repaired matrix follows.

At clean commit `636e71e3d6084da6badeb0055fef5aae19ca4f58`, the fresh
hostile reviewer `/root/exact_review_where_realm` found no blocker for this
bounded WHERE Date equality matrix. The focused WHERE and subset suites passed
53 tests with no type errors. The reviewer reconstructed the model classes,
checked tagged source rows and literals at initial and post-commit cuts, and
traced the live keys, subscriber reconstruction, and public snapshots in both
modes. The explicit BasicIndex lookup and `optimizedOnly: true` snapshot prove
an indexed public read, without claiming the live-query planner selected it.
The archived `9a145fba1` run failed at the intended unindexed public equality
comparison by omitting `foreign-tagged-one`; its unmodified controls passed.
The verdict does not cover other hosts, public ranges, indexed order,
arbitrary histories, or Date objects with replaced prototypes or methods.

## Tagged Date subclass follow-up

The hostile review at `ae0b67fd2` found that a native foreign Date subclass
with an own display tag missed `eq(Date(1))` in a public live query. The matrix
now assigns fixed local and foreign subclass rows and literals to timestamp
classes independently of production classification. It also includes an
invalid foreign subclass and an ordinary object borrowing a foreign subclass
prototype as a negative control. Initial and post-commit observations compare
the complete public live-query rows, filtered subscriber keys, direct snapshot
keys, explicit BasicIndex lookup, and an optimized-only snapshot. The original
implementation failed first at the unindexed live-query key set by omitting
`foreign-subclass-one`. The descriptor-chain repair passed both receiving
oracles, 127 tests, with no type errors. Live-query planner index use, generated
subclass histories, deeper subclass chains, other hosts, public ranges, and
prototype/method replacement remain outside this witness. Fresh exact-commit
review is pending.

## Local borrowed-prototype counterexample at `be5b7a3c4`

A fresh hostile reviewer found that the matrix's foreign borrowed-prototype
object never reached the local `instanceof Date` fast path. An ordinary object
made with `Object.create(LocalDateSubclass.prototype)` has no native Date
slot, although local `instanceof Date` returns true. In an unindexed public
query, `not(eq(v, Date(1)))` omitted its only row instead of publishing that
row. The new focused witness establishes the missing slot with the native
intrinsic, then checks both Date inequality and same-object identity after
preload. It failed at the public key set on the reviewed commit and passed
after the guarded Date-classifier repair. The matrix still preserves the
foreign borrowed-prototype control. This addition covers one unindexed row;
indexed publication for the local impostor and other host realms remain open.

## Invalid-Date exclusion at the public WHERE cut

The hostile review of frozen head
`210651d207eefe9bbc025c780f6259e470225c9e` found one remaining
source-inspection gap in the local borrowed-prototype control. The existing
unindexed `not(eq(v, Date(1)))` and same-object `eq` checks could pass if
the borrowed object also joined the invalid-Date/NaN equality class. The
working-tree witness now preloads a public `eq(row.v, new Date(NaN))` query
and requires an empty key set for that same borrowed row. This added cut
did not demonstrate a new production failure. The coverage map now states
the bounded matrix's four post-commit updated rows accurately.

The witness establishes this single local borrowed object at an unindexed
public checkpoint. It does not cover indexed publication for that object,
arbitrary prototype chains, or other host realms. A committed-head hostile
review of the working-tree addition remains pending.

The follow-up review of `d974d4a4f` also found an overstatement in the
WHERE publication oracle's opening prose. Its generated histories compare
direct snapshots when subscribers attach, then reconstruct subscriber and
live-query key sets after each sync commit. The fixed Date matrix compares
direct snapshots both before and after its commit. The prose now names those
separate checkpoints. No behavior or product expectation changed in this
clarification. Final exact-commit hostile review remains pending.

## Zero timestamp false-green control at `0c236f448`

A read-only hostile review found that the local borrowed-prototype object's
existing checks could still pass if it erroneously joined the valid zero
Date/number equality class. The owner now asks two additional public live
queries for `eq(row.v, new Date(0))` and `eq(row.v, 0)` after preload. Both
must return no rows for that ordinary object. These controls use public
publication rather than a direct comparison helper and distinguish object
identity from timestamp zero and numeric zero. The focused 81-test run
including them passed with no type errors. The later working-tree focused and
neighboring run passed 985 tests across 11 suites. This does not establish
indexed publication for the forged object, other borrowed prototypes, or
other host realms. Exact committed-head review of these controls is pending.
