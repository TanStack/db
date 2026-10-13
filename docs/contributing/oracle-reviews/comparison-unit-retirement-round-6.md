# Comparison unit retirement: Temporal order

A source-isolated Field Lab loss audit compared two Temporal blocks in
`packages/db/tests/comparison.test.ts` with the comparison oracle at frozen
head `c038b2b673a601d3bfbc70261f2cbb61f6f934ea`. The receiver had no
Temporal input. These four observations were frozen before the blocks were
removed. The symbol block and two `compareValues` NaN blocks stay in the unit
file because they have different obligations.

| Retired block | Original observation | Receiving oracle |
| --- | --- | --- |
| PlainDate calendar order | January 2024 precedes June 2024; reversing the operands is positive; a fresh January value compares at exact zero. | Supplied ISO year, month, and day fields predict both signs and exact equal-date zero. Fixed operands reconstruct January and June; generated fields vary each part. |
| ZonedDateTime instant order | 06:30 UTC and 12:00 +05:30 representations of one instant compare at exact zero. | Supplied epoch-nanosecond offsets predict both signs and zeros across four offset zones, including one-nanosecond neighbors. |

Changelog #1519 promises Temporal static comparison for `orderBy` and range
operators. It specifies instant order for ZonedDateTime, while `eq` retains
zone as part of identity. The receiver models PlainDate calendar fields and
ZonedDateTime instants independently of production dispatch and Temporal's
static comparator. Its driver builds ordinary values from one polyfill copy,
calls `ascComparator` with default options, and compares each direct return.
It does not claim `compareValues`, index, public query, or provider behavior.

The grammar uses ISO PlainDates in years 2000–2030 with days 1–28. It uses
ZonedDateTimes within two seconds of a fixed 2024 instant in UTC, +05:30,
-05:00, and +14:00. Equal-value branches create separate objects; adjacent
instants differ by one nanosecond. Mixed Temporal kinds, unsupported
PlainMonthDay order, subclasses, altered constructors or prototypes, and
mixed native/polyfill implementations are outside this transfer.

## Review and replay

The fixed cases reconstruct all four old assertions. A wrong comparator
that uses zoned display text fails the equal-instant sign check; a
millisecond-truncating comparator fails the adjacent-instant check. ISO
PlainDate display text has the same order as the tested calendar fields, so
the text-order control only distinguishes the zoned law. The generated
properties run fixed-seed and seedless 100-case campaigns. Direct replays
38 and 39 at seed `20260911`, path `0`, passed.

The latest hostile reviewer read the retired assertions, model, production
comparator, and coverage map. It found no lost assertion within the direct
`ascComparator` scope. The focused comparison suite passed 100 tests with
no type errors. The production change removes a tag-wide dispatch cache.
For ordinary Temporal objects this preserves the required static comparison
while reducing code. Earlier PR revisions tested caller-modified constructors,
spoofed tags, and subclasses; the maintainer declined guarantees for modified
standard values, and those witnesses are not part of this transfer.

## Oracle guide boundary

The opening contract identifies #1519 and the direct-return limit (ORC-001).
Supplied fields and offsets determine the expected result without importing
production classification or comparison (ORC-002). The oracle places model,
grammar, driver, observation, and comparison beside explanatory prose
(ORC-003). Fixed operands and generated year, month, day, zone, equal-instant,
and adjacent-nanosecond dimensions cover the bounded grammar (ORC-004).
`ascComparator` returns are checked immediately (ORC-005). Wrong text and
truncated-instant results fail those checks (ORC-006 and ORC-013). Direct
seed/path replay verifies the shared campaign harness (ORC-007 and ORC-010).
The tuple and instant model has no mutable state or host provider (ORC-008,
ORC-009, and ORC-014). This record preserves the loss audit, hostile review,
and explicit limits (ORC-011 and ORC-012); it makes no cross-boundary claim.

## Exact code-commit review

At `24a61a8d5b6cef06d488c490e39f351b4d55fb68`, a fresh hostile reviewer
reconstructed the three PlainDate assertions and equal-instant zoned
assertion from the committed oracle. The comparator and oracle blobs match
the versions reviewed before commit. Its focused comparison and evaluator
run passed 236 tests with no type errors. It found no lost ordinary
same-realm assertion. Modified Temporal inputs, `compareValues`, and public
query or index paths remain outside this verdict.
