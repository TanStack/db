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
One sync transaction moves three source rows across equality classes, and the
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
across 73 files with no type errors. The scope is native local and `node:vm`
Dates, finite timestamps 1 and 2, invalid Dates and NaN, one three-row sync
transaction, and the named observations. Other realm hosts, proxies,
subclasses, spoofed tags, arbitrary timestamp histories, and planner proof of
live-query index selection remain outside this witness.

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
fresh committed-head review of the repaired matrix remains pending.
