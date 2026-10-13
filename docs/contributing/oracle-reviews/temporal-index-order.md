# Temporal indexed order

The direct comparison transfer in [round 6](comparison-unit-retirement-round-6.md)
does not exercise an index. A separate oracle checks the public index contract:
an ordered take must follow `ZonedDateTime` instant order, while exact equality
keeps zones distinct. The law comes from Temporal's `ZonedDateTime.compare` and
`equals` semantics, changelog #1519, and the Collection's ordered-read and
IndexInterface contracts. The live-query architecture also requires an
ordered comparator group to keep a representative from a live exact-value
bucket. The direct index's established source-key rule orders two rows at the
same instant. The public ordered snapshot does not promise which
equal-instant peer occupies a limit-one window, so that observation accepts
either peer.

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
DB suite passed 12,171 tests in 279 files with no type errors. A later exact
commit review found the custom alias gap below, so those counts describe an
intermediate commit rather than final verification.

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
representation. The exact-commit reviewer then found that a callback could
distinguish UTC and Etc/UTC values in one query-equality class. Both indexes
merged the exact key before comparing those rows, so ordered takes, ranges,
and cursors disagreed with the callback. Six new add/build/update witnesses
failed at `takeFromStart` on `1265abeb5`, with no type errors. The repair keeps
exact lookup and comparator positions as separate partitions. The witnesses
now check the callback's exact former display-string operands, equality lookup,
range boundaries, both cursor directions, representative removal, and a
same-class update. The focused 470-test index campaign passed with no type
errors after repair. Direct removal supplies the actual prior source value;
no equivalence-substitution guarantee is claimed for a different old item.
For this PR, the maintainer selected per-row callback order when a comparator
distinguishes values in one query-equality class. This is the contract the
separate partitions implement.
Mixed domains, other Temporal kinds, public WHERE ranges, provider cursors,
longer histories, and live-query publication remain outside this oracle.
Existing range optimization does not claim Temporal WHERE correctness.

A subsequent direct comparison witness found that a genuine ZonedDateTime
with an own shadowed `Symbol.toStringTag` lost its native instant order.
The matching index witness failed in all four BasicIndex/BTreeIndex add/build
histories at the value cursor: it returned the equal-instant peer instead of
the one-nanosecond successor. Classification now reads a slot-checking
prototype method, so the own display tag cannot choose an ordinary-object
position. The direct and index witnesses pass after that repair. The fixed
index witness does not establish custom comparator behavior with a shadowed
tag or mixed Temporal implementations.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | The opening names instant order, zone-sensitive equality, live representatives, authority, and the bounded domain. Equal-instant tie order is deliberately unspecified. |
| ORC-002 | Supplied BigInt instants and zone classes determine expected order and exact matches independently of normalization and comparison code. |
| ORC-003 | The oracle describes its law, fixture model, legal actions, direct and public drivers, observations, and checkpoints beside executable code. |
| ORC-004 | Not triggered: the bounded fixture matrix and one continuation are fixed histories, not a generated-history claim. The nearby invalid mixed-kind domain is excluded. |
| ORC-005 | Direct takes, ranges, cursors, and equality lookups observe both index implementations. An optimized-only Collection snapshot invokes the explicit index's `takeFromStart` after readiness. |
| ORC-006 | The original normalized-string design failed at direct ordered takes and the public `limit: 1` snapshot. A stable wrong-result control rejects that later-instant first row while allowing both legitimate equal-instant ties. The first BTree repair failed the live-bucket representative check; a tuple-fed custom comparator failed the pre-epoch take check; the merged-exact-key design failed six alias/callback takes. Own-tag shadows failed all four value-cursor checks before the branded dispatch repair. |
| ORC-007 | Not triggered: this is a bounded fixed oracle, not an important generated property. The existing index refinement property keeps its own campaigns. |
| ORC-008 | Not triggered: the fixture's independent model has no mutable reference state. |
| ORC-009 | The model's instant label represents default order only; its zone class represents exact equality. One comparator position can contain two exact values, and a custom callback can split one exact value into two positions. The callback-argument witness checks exact former input text. |
| ORC-010 | `withOracleCleanup` preserves a primary public mismatch and releases the Collection. Direct indexes own no external resources. |
| ORC-011 | The unindexed public scan is a second production formulation for the ordered result. The numeric BigInt model also distinguishes a shared display-string mistake. |
| ORC-012 | This record contains RED/GREEN evidence, a hostile review, and scoped unresolved cells. An exact-commit verdict follows below. |
| ORC-013 | The equal-instant zones and one-nanosecond neighbor distinguish collapse and truncation; the later instant with earlier display text distinguishes lexical order. |
| ORC-014 | Not triggered: the Collection has controlled sync and the claim ends at its in-memory ordered snapshot, with no real-provider claim. |

## Exact committed-head review

At `ae0b67fd2`, a fresh hostile reviewer found no blocker in the stated
default and custom ordered-index domain. All 25 focused tests passed. Its
independent bounded histories exercised both index types under both order
rules, and a wrong-result probe confirmed that the optimized public snapshot
uses the index result. Provider cursors, arbitrary callbacks, and live-query
publication remain outside this verdict.

## Frozen-head direct tie-order recheck

The hostile review of `210651d207eefe9bbc025c780f6259e470225c9e`
found a source-inspection sensitivity gap, not a demonstrated production
defect. The direct oracle had allowed either source-key order for two
equal-instant peers. It now admits those peers in reverse key order through
both `add` and `build` and requires the direct `takeFromStart(2)` result to
follow the established source-key tie rule in BasicIndex and BTreeIndex. The
public limit-one tie remains permissive. This addition covers only the
named equal-instant fixture and direct index checkpoint.

The maintainer confirmed the custom comparator contract: when a callback
distinguishes two `ZonedDateTime` rows that native `.equals()` groups
together, ordered index operations follow the callback for each row. The
existing oracle checks that decision through add/build, exact lookup,
range and cursor reads, removal, and update for UTC/Etc-UTC peers. Review of
committed head `d974d4a4f` found that those checks could accept display-text
order in place of callback order. A new opposite callback puts UTC first,
while both display-text and source-key order put the alias first; add/build
takes, range, and cursor results must follow that callback. Its focused run
passed 33 tests. This round does not collapse the peers' positions or reject
that comparator/value combination. The earlier 497-test focused campaign
and 12,345-test DB campaign describe the committed baseline, before this
opposite-callback witness. A fresh exact-commit hostile review of the
follow-up remains pending.
