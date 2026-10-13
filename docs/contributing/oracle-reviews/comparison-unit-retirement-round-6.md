# Comparison unit retirement: Temporal order

A source-isolated Field Lab loss audit compared the two Temporal blocks in
`packages/db/tests/comparison.test.ts` with the comparison oracle at frozen
head `c038b2b673a601d3bfbc70261f2cbb61f6f934ea`. The receiver expressly
excluded Temporal. The audit recovered these four assertions before the two
blocks were removed. The symbol block and both `compareValues` NaN blocks stay
in the unit file because they have different obligations.

| Retired block | Original observation | Receiving oracle |
| --- | --- | --- |
| `orders PlainDate values by calendar date` | January 2024 precedes June 2024; the reverse comparison is positive; a fresh January value compares at exact zero. | Supplied ISO year/month/day tuples predict both signs and exact equal-date zero. The fixed case reconstructs January and June; generated tuples vary all three fields. |
| `treats ZonedDateTime values at the same instant as equal regardless of zone` | The 06:30 UTC and 12:00 +05:30 displays of one instant compare at exact zero. | Supplied epoch-nanosecond offsets predict both comparison directions. The fixed case reconstructs the two displays; generated cases vary offset zones, equal instants, and adjacent instants. |

Changelog #1519 promises Temporal static comparison for `orderBy` and range
operators. It says `ZonedDateTime` comparison uses the instant while `eq`
keeps the zone as part of identity. The receiving model uses calendar tuples
and supplied nanosecond offsets, not production's Temporal dispatch or
normalization. The driver constructs ordinary values from one polyfill copy.
Each `ascComparator` return under default options is the comparison cut.
This direct lane also probes the shared `compareValues` helper in hostile
dispatch histories. It does not claim public query, index, or provider behavior.

The grammar uses ISO PlainDates in years 2000–2030 with days 1–28. It uses
ZonedDateTimes within two seconds of a fixed 2024 instant in UTC, +05:30,
-05:00, and +14:00 zones. Equal-value branches construct distinct instances;
an adjacent-instant branch differs by one nanosecond. Fixed text-order and
millisecond-truncation controls fail the model comparison. Mixed Temporal
kinds, unsupported `PlainMonthDay` ordering, custom subclasses or prototype
replacement, and mixed native/polyfill implementations are outside this
transfer. The separate index owner below tests another production path.

## RED witness and hostile review

At unchanged production head `c038b2b673a601d3bfbc70261f2cbb61f6f934ea`,
the tag-wide comparator cache could learn a bogus static `compare` from the
first operand. A genuine PlainDate with an own `constructor.compare` returning
zero made January and June compare equal. A plain object with a forged
`Temporal.PlainDate` display tag could poison later genuine comparisons too.
Fresh-module histories prevent test order from seeding the cache first. The
focused run had eight passing Temporal checks and three intended failures at
the comparator-result assertions, with no type errors. A right-operand shadow
case also rejects a plausible repair that reads the second operand's own
constructor. A `compareValues`-first history reaches the other direct entry
point. The original four assertions pass in the fixed reconstruction.

The fresh hostile reviewer `/root/hostile_temporal_direct` compared each
retired assertion with the new model and original source. It found the forged
tag, right-operand, and nanosecond precision gaps; the revised oracle added
those controls before production changed. The reviewer then rechecked the RED
run and found no remaining loss in the two retired blocks. It found a separate
published API-reference description of the old cache; this change updates
that page. Replaced prototypes, overridden subclass static comparators, and
mixed native/polyfill values remain excluded. These are recorded limits, not
claims that the comparator handles every altered Temporal object.

The production repair removes the tag-wide cache and reads the static compare
function from the value's prototype on each call. The repaired direct and
evaluator suite passed 248 tests with no type errors. The exact committed-head
verdict follows after commit.

The later equality review exposed a separate order defect: a genuine
ZonedDateTime with an own `Symbol.toStringTag` shadow was treated as an
ordinary object. A direct witness failed at the equal-instant
`ascComparator` return on the unrepaired code. The shared branded dispatch
now reads the Temporal prototype and checks native slots; direct
`ascComparator` and `compareValues` preserve the supplied instant order.
The index-order owner has a corresponding value-cursor witness.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Changelog #1519 supplies calendar/instant order and zone-sensitive equality. The opening and this record bound value kinds, implementation, paths, and checkpoints. |
| ORC-002 | Supplied date fields and nanosecond offsets predict signs without calling production comparison, normalization, or Temporal static compare. |
| ORC-003 | Prose beside the models explains the law, grammar, direct production paths, return observations, and refinement checks. |
| ORC-004 | Fixed cases reconstruct all four source assertions. Additional year-, month-, and day-separated pairs distinguish calendar-field omissions; distinct instances, zones, equal instants, and one-nanosecond neighbors distinguish the other axes. The bounded ranges and excluded value classes are stated above. |
| ORC-005 | Both direct exported helpers run on real Temporal values. Their exact returns, signs, and equal-value zeros are compared immediately. This is not public query evidence. |
| ORC-006 | A text-order control and a millisecond-truncation control fail at the sign check. The original cache fails three hostile histories at the same comparison cut. |
| ORC-007 | The shared comparison harness runs fixed-seed and seedless 100-case campaigns with the same property and supports direct seed/path replay. Replay evidence is recorded below. |
| ORC-008 | Not applicable: tuple and instant models have no mutable state. Fresh modules control production cache history, not reference-model state. |
| ORC-009 | Date tuples and nanosecond offsets are model input labels. Comparator zero describes order position, while `eq` identity retains the zone. |
| ORC-010 | The shared harness keeps the original failure checkpoint through shrinking. The direct tests own no cleanup resource. |
| ORC-011 | Not triggered: the reviewer named no plausible fault shared by the calendar/instant model and production within this bounded lane. Text-order and millisecond injections are ORC-006 wrong-result controls. The index/public path has its own oracle. |
| ORC-012 | This record contains the source ledger, RED/GREEN evidence, hostile verdict, limits, and committed-head recheck. |
| ORC-013 | Equal instants in different zones and adjacent nanoseconds distinguish text order and millisecond truncation from the promised instant law. |
| ORC-014 | Not applicable: this lane has no controlled provider or claim across a host boundary. |

## Direct replay and exact committed-head review

The shared harness directly replayed the PlainDate and ZonedDateTime generated
properties as selectors 39 and 40 with seed `20260911` and path `0`. Each
requested replay passed with no type errors; 39 other properties were skipped
in each run. After the final index oracle edit, the full DB suite passed
12,154 tests in 278 files with no type errors. The DB package build passed.
At committed head `8b04592724fb943b04a56c6682757448d26a8ff6`, the fresh
hostile reviewer `/root/exact_temporal_comparison_review` found no lost
assertion in the two retired blocks. It reconstructed the original PlainDate
and ZonedDateTime operands and checked all four assertions at the direct
`ascComparator` return. Its focused run passed 112 comparison tests and 149
evaluator/index tests with no type errors. It replayed properties 39 and 40
with seed `20260911` and path `0`. The reviewer corrected the ORC-011
classification above. Cross-realm Temporal values remain outside this verdict.

## Review of the next committed head

At `c4c07da42`, a fresh reviewer again found all four retired assertions
preserved. It found a helper-specific false green: the right-hand
constructor-shadow history exercised `ascComparator` with the shadowed
PlainDate, but passed ordinary values to `compareValues`. The direct helper
now receives that same shadowed right operand and must return the supplied
negative calendar sign. The focused comparison, alias, and utils run passed
258 tests with no type errors after this addition.

The reviewer also reproduced asymmetric comparisons for ordinary objects
given a spoofed Temporal prototype. This is outside the declared
custom-prototype domain and is not evidence of closure for that domain. The
comparison owner needs a separate brand and mixed-value witness before
claiming it. Fresh review of the final committed head remains pending.

## Frozen-head hostile recheck

At `210651d207eefe9bbc025c780f6259e470225c9e`, a hostile ledger/source
review found no lost assertion in the two retired PlainDate and ZonedDateTime
comparison blocks. Their direct helper checkpoints and supplied operand pairs
remain covered. The review does not extend that verdict to the subsequent
working-tree changes.

A distinct counterexample involved a genuine `ZonedDateTime` subclass whose
inherited native `.equals()` accepts an ordinary UTC peer. The old classifier
treated it as an ordinary object. The [Temporal alias owner](temporal-equality-alias.md)
now supplies the subclass equality and borrowed-prototype controls and records
the RED/GREEN production repair. This issue is outside the two retired direct
comparison assertions. The custom-prototype question above remains open.

At committed head `d974d4a4f`, review exposed a second subclass boundary:
a genuine `ZonedDateTime` subclass with a shadowed prototype display tag was
classified as an ordinary object. The direct comparison owner now supplies
the instant and one-nanosecond successor independently, verifies the native
`Temporal.ZonedDateTime.compare` premise, and checks exact equal-instant zeros
and both signs through `ascComparator` and `compareValues`. The adjacent
[alias review](temporal-equality-alias.md#tagged-subclass-follow-up-after-d974d4a4f)
records the direct-index and public-`eq` RED/GREEN repair. This is an adjacent
product defect, not a recovered assertion from the two retired ordinary-value
blocks. Other subclasses, replaced methods, mixed implementations, and
arbitrary prototype chains remain open. A fresh hostile review of the final
committed follow-up is pending.

Read-only hostile review of `0c236f448` ran 122 comparison tests and found
no lost assertion from the two retired ordinary Temporal blocks. It corrected
the coverage-map attribution for the tagged subclass: direct
`ascComparator` and `compareValues` compare the subclass with a +05:30 peer
at the same instant, while the alias owner separately checks native
`.equals()` against a UTC peer and the borrowed-prototype control. Those
observations support different boundaries; the direct comparison owner does
not itself prove the public equality result. The final committed follow-up
still needs a fresh hostile review.
