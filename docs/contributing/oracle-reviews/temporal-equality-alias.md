# Temporal alias equality

Changelog #1519 promises `ZonedDateTime` query equality consistent with
Temporal's `.equals()`. At one instant, `[UTC]` and `[Etc/UTC]` are equal,
while `[+00:00]` is a distinct zone. Exact nanoseconds and calendar identity
also matter. The new oracle assigns those classes in its fixture, then checks
direct BasicIndex and BTreeIndex lookups after add, build, and removal, plus
unindexed and optimized-only indexed public `eq` snapshots. The existing `in`
evaluator oracle now uses captured native Temporal methods as its independent
reference for kinds with `.equals()` and ten intrinsic fields for Duration. It
checks constant and row-supplied lists, including forged, borrowed, and
shadowed controls.

## Failure and repair

At frozen commit `8b04592724fb943b04a56c6682757448d26a8ff6`, exact
keys used display strings. Eight new direct and public alias checks failed at
their equality comparisons; the distinct-zone fixture control passed.
Four `in` checks also failed against the corrected reference, with no type
errors. The shared production cause was `normalizeValue`, so a repair limited
to an index would leave unindexed `eq` and `in` wrong.

The repair keys ordinary ZonedDateTimes by kind, epoch nanoseconds,
canonical zone ID, and calendar ID. It reads those three fields through
prototype getters so an own property cannot change a Temporal instance's
equality class. A plain object with a forged Temporal tag remains an ordinary
object. Before that guard, the forged object and a genuine fixed-offset value
whose `timeZoneId` property shadowed its internal zone both matched a UTC
probe; the new direct-index and public-scan control rejected them.

An independent read-only sweep compared the proposed zone key with native
`.equals()` on 177,906 same-instant pairs across 597 host zone IDs, finding
no partition mismatch. This bounds evidence for that host, not a proof for
every Temporal implementation or time-zone database. The focused index,
evaluator, and Temporal runs passed 453 tests with no type errors after the
repair. The full DB suite passed 12,171 tests in 279 files with no type
errors. The exact-commit review then found the gaps below, so that count
belongs to an intermediate commit.

## Exact-commit counterexamples and follow-up

At commit `1265abeb5`, hostile reviewers found that a genuine PlainDate with
an own `Symbol.toStringTag` or `toString` shadow could miss a native-equal
value through compiled `in`. A plain object with a forged PlainDate tag could
match a genuine value. A genuine ZonedDateTime with a shadowed tag could miss
through direct indexes and public `eq`. The `in` reference had trusted an
instance's display tag and therefore agreed with one wrong production answer.
Its Duration wording also claimed `.equals()` even though Duration has no such
method. Eleven new brand, shadow, and Duration checks failed at the intended
comparisons on the original code, with no type errors.

The follow-up reference calls captured polyfill intrinsics on the candidate to
establish its brand and models Duration with ten field getters. Production
normalization reads slot-checking methods from the value's prototype rather
than its own display members. The alias owner also checks the later-instant
and alternate-calendar classes and a PlainDate forged/borrowed/shadowed lane
through direct singleton lookups and an unindexed public snapshot. The focused
39-test alias and `in` oracle run passed with no type errors after repair.
The mixed ordinary-object/Temporal ordered index is excluded because its
range order is unspecified. Arbitrary custom prototypes that imitate genuine
Temporal methods remain outside the one-polyfill brand guarantee.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Changelog #1519 and Temporal `.equals()` authorize the equality classes. The Duration field-vector rule follows #1519's explicit `eq` distinction. The opening oracle comment limits implementations, paths, and observations. |
| ORC-002 | Fixture-assigned classes predict key sets without calling production normalization. Native `.equals()` calibrates supported kinds; captured intrinsic Duration fields calibrate Duration. |
| ORC-003 | Prose beside the model, add/build history, Collection driver, and assertions explains their roles. |
| ORC-004 | Not triggered by this fixed oracle. The separate generated `in` owner controls its bounded list grammar. |
| ORC-005 | Direct lookups observe both index types for orderable kinds; an indexed public snapshot spies on `lookup`, and unindexed snapshots check the evaluator path after readiness. PlainMonthDay has no indexed claim. |
| ORC-006 | The frozen display-string design failed alias checks. The first tuple design failed forged-tag and shadowed-zone controls. Commit `1265abeb5` failed eleven brand/shadow/Duration checks; `c4c07da42` failed the intrinsic-field equality controls. A lexical `in` mutant fails its comparison. |
| ORC-007 | Not triggered by this fixed oracle. The adjacent `in` owner retains fixed and random generated campaigns. |
| ORC-008 | The fixture model is immutable and has no reference-model state. |
| ORC-009 | The model's class labels denote query equality, distinct from the order oracle's instant labels. |
| ORC-010 | Collection cleanup preserves the primary mismatch. Direct index checks own no external resource. |
| ORC-011 | Direct lookup and public scan cross different production paths, but share normalization. Native `.equals()` and the Duration field-vector rule provide independent semantic calibration; this record does not claim a second full reference model. |
| ORC-012 | This record names the owner, RED controls, limits, the rejected PlainMonthDay index design, and required exact-commit review. |
| ORC-013 | Alias equality versus fixed-offset inequality separates display-only and instant-only keys; same-display reference-field and Duration pairs reject string-only keys. Native-brand controls reject forged/borrowed impostors while genuine display shadows preserve equality. |
| ORC-014 | The Collection uses controlled in-memory sync and ends its claim at the snapshot; no provider handoff is claimed. |

## Limits and exact-commit review

The ZonedDateTime lane covers one polyfill copy and one instant; the
PlainDate lane checks brand shadows at one calendar date. Other IANA aliases,
arbitrary spoofed prototypes, mixed Temporal implementations, joins, grouping,
query identity, live-query publication, provider paths, and longer histories
need their own witnesses. The `in` owner adds generated list membership but
not those other boundaries. `Intl` canonicalization has a raw-ID fallback when
the host rejects a valid Temporal zone; alias equivalence in that case is
unproved. The index-order owner now checks a custom comparator that
separates query-equal aliases. Direct D2 `groupBy` has a separately approved
kind-and-string policy.

At committed head `c4c07da42`, a fresh reviewer found no mismatch in the
exercised alias cases but found that the previously reported genuine
ZonedDateTime own-tag failure lacked a direct witness here. The fixture now
adds genuine UTC rows with an own shadowed display tag and an own shadowed
`toString`. Native `ZonedDateTime.prototype.equals` confirms their equality
with the alias probe. Add, build, removal, unindexed public `eq`, and
optimized-only indexed public `eq` must all retain those rows. The focused
run passed 11 alias tests with no type errors. Final committed-head review
remains pending.

## Intrinsic-key counterexamples and index boundary

The same `c4c07da42` review found three Temporal equality classes whose
default display omits identity fields. Native `.equals()` distinguishes
PlainMonthDay reference years and PlainYearMonth reference days. Changelog
#1519 keeps Duration field representations distinct under `eq`, even when
both display as `PT1S`. Compiled `eq`, constant `in`, and row-supplied `in`
returned false matches before the production repair. New fixed pairs check
equal copies and unequal same-display values in both operand directions.
Normalization now reads the intrinsic reference fields and ten Duration
fields. The receiving `in` model reads captured polyfill methods and getters.

This alias oracle carries the same equality classes to a public unindexed
PlainMonthDay scan. Its PlainYearMonth and Duration lanes check direct index
add, build, removal, and re-add, plus public scan and indexed `eq`. Each
fixture assigns classes from constructed fields without using production
normalization. The six focused suites passed 619 tests after the repair.

An attempted one-class PlainMonthDay index bypass was rejected during law
review. With two native-equal rows, a BasicIndex made public `orderBy` return
keys, while the unindexed query threw as changelog #1519 specifies. Adding a
later distinct reference-year row then threw during a valid sync commit. The
bypass was removed. Direct and public indexed PlainMonthDay equality across
multiple classes remains open. An exact-only index path needs a separate
oracle for add, build, remove, update, and the orderBy rejection.
