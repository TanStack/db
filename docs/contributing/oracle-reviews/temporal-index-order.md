# Temporal indexed order

The direct comparison transfer in [round 6](comparison-unit-retirement-round-6.md)
does not exercise an index. A separate oracle checks the public index contract:
an ordered take must follow `ZonedDateTime` instant order, while exact equality
keeps zones distinct. The law comes from Temporal's `ZonedDateTime.compare` and
`equals` semantics, changelog #1519, and the Collection's ordered-read and
IndexInterface contracts. The live-query architecture also requires an
ordered comparator group to keep a representative from a live exact-value
bucket. No public contract fixes the key order of two rows at the same
instant, so the oracle accepts either tie order.

## Original failure and repair

At frozen head `c038b2b673a601d3bfbc70261f2cbb61f6f934ea`, both BasicIndex
and BTreeIndex normalized Temporal values to display strings before ordering.
For the supplied rows, `d-minus-five` has a later instant than the UTC and
+14:00 rows but an earlier display string. Both direct index types returned it
first after `add` and `build`. An optimized-only public Collection snapshot
with `limit: 1` exposed the same wrong first row; the unindexed control returned
an earliest-instant row. These failures occurred at the intended ordered-key
and public-snapshot comparisons. The exact same-instant zones retained separate
equality lookups.

The repair retains normalized exact keys for equality and stores raw Temporal
values for ordered positions. A removal control caught the first repair
retaining a BTree representative whose exact-value bucket had departed.
The corrected BTree replaces that representative with one from a remaining
bucket. An initial hostile objection treated this as an unwarranted private
assertion; rechecking the normative architecture established its authority.
The existing index refinement oracle also rejects the version that removed
the replacement. The original repaired commit passed 13 focused tests and
the index refinement oracle's 412 tests, then the full DB suite passed
12,154 tests in 278 files. After the alias and comparator controls, the full
DB suite passed 12,171 tests in 279 files with no type errors. The final
exact-commit review remains pending.

The independent fixture supplies epoch nanoseconds and zone-identity classes.
It never calls the index's normalization or comparator to compute expected
results. A prefix checker requires all earlier instants, no later instants,
unique keys, and instant order. It permits either choice at an equal-instant
limit boundary. Exact lookup compares zone-sensitive key sets. The grammar has
two opposing offset zones at one instant, a successor one nanosecond later,
a later instant with earlier display text, and three pre-epoch values that
distinguish signed numeric order from decimal-string order. It exercises direct
`add`, `build`, a value cursor past both equal-instant peers, one
remove/insert/update continuation, and an explicit index in an optimized-only
Collection read after sync readiness. The collection driver spies on the
chosen index's `takeFromStart` to prove the intended path ran.

## Hostile review and limits

A separate hostile reviewer traced the exact-key and ordered-value paths in
both indexes, examined the original failure, and checked the repaired public
index selection. It found no blocker within the bounded default-comparator
domain. It identified a callback compatibility regression: a custom
`compareFn` received raw Temporal objects where it previously received
normalized strings. A first follow-up kept the string type but supplied a
new epoch tuple; a pre-epoch callback witness rejected its wrong direct
ordered result in both index types. The repair now passes the former display
key to custom callbacks while storing raw values for index order. This is a
bounded compatibility decision; published types do not promise the operand
representation. A custom comparator that distinguishes two values in one
query-equality class remains open. Mixed domains, other Temporal kinds,
public WHERE ranges, provider cursors, longer histories, and live-query
publication also remain outside this oracle. Existing range optimization
does not claim Temporal WHERE correctness.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | The opening names instant order, zone-sensitive equality, live representatives, authority, and the bounded domain. Equal-instant tie order is deliberately unspecified. |
| ORC-002 | Supplied BigInt instants and zone classes determine expected order and exact matches independently of normalization and comparison code. |
| ORC-003 | The oracle describes its law, fixture model, legal actions, direct and public drivers, observations, and checkpoints beside executable code. |
| ORC-004 | Not triggered: the bounded fixture matrix and one continuation are fixed histories, not a generated-history claim. The nearby invalid mixed-kind domain is excluded. |
| ORC-005 | Direct takes and equality lookups observe both index implementations. An optimized-only Collection snapshot invokes the explicit index's `takeFromStart` after readiness. |
| ORC-006 | The original normalized-string design failed at direct ordered takes and the public `limit: 1` snapshot. A stable wrong-result control rejects that later-instant first row while allowing both legitimate equal-instant ties. The first BTree repair failed the live-bucket representative check; a tuple-fed custom comparator failed the pre-epoch take check. |
| ORC-007 | Not triggered: this is a bounded fixed oracle, not an important generated property. The existing index refinement property keeps its own campaigns. |
| ORC-008 | Not triggered: the fixture's independent model has no mutable reference state. |
| ORC-009 | The model's instant label represents order only; its zone class represents exact equality. One comparator position can contain two exact values. The custom callback witness checks backward compatibility for its input text, not Temporal's default instant law. |
| ORC-010 | `withOracleCleanup` preserves a primary public mismatch and releases the Collection. Direct indexes own no external resources. |
| ORC-011 | The unindexed public scan is a second production formulation for the ordered result. The numeric BigInt model also distinguishes a shared display-string mistake. |
| ORC-012 | This record contains RED/GREEN evidence, a hostile review, and scoped unresolved cells. An exact-commit verdict follows below. |
| ORC-013 | The equal-instant zones and one-nanosecond neighbor distinguish collapse and truncation; the later instant with earlier display text distinguishes lexical order. |
| ORC-014 | Not triggered: the Collection has controlled sync and the claim ends at its in-memory ordered snapshot, with no real-provider claim. |

## Exact committed-head review

Pending.
