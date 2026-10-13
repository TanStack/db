# Temporal alias equality

Changelog #1519 promises `ZonedDateTime` query equality consistent with
Temporal's `.equals()`. At one instant, `[UTC]` and `[Etc/UTC]` are equal,
while `[+00:00]` is a distinct zone. Exact nanoseconds and calendar identity
also matter. The new oracle assigns those classes in its fixture, then checks
direct BasicIndex and BTreeIndex lookups after add, build, and removal, plus
unindexed and optimized-only indexed public `eq` snapshots. The existing `in`
evaluator oracle now uses `.equals()` as its independent Temporal reference
and checks both constant and row-supplied lists, including the forged and
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
errors. The exact-commit review follows after commit.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Changelog #1519 and Temporal `.equals()` authorize the equality class; the opening oracle comment limits implementations, paths, and observations. |
| ORC-002 | Fixture-assigned classes predict key sets without calling production normalization. A separate native `.equals()` check calibrates the fixture. |
| ORC-003 | Prose beside the model, add/build history, Collection driver, and assertions explains their roles. |
| ORC-004 | Fixed classes distinguish alias equality, distinct zone, adjacent nanosecond, calendar, forged tag, and shadowed accessor. No generated-history claim is made. |
| ORC-005 | Direct lookups observe both index types; an indexed public snapshot spies on `lookup`, and the unindexed snapshot checks the evaluator path after readiness. |
| ORC-006 | The frozen display-string design failed alias checks. The first tuple design failed forged-tag and shadowed-zone controls at direct lookups. A lexical `in` mutant fails its check. |
| ORC-007 | Not triggered by this fixed oracle. The adjacent `in` owner retains fixed and random generated campaigns. |
| ORC-008 | The fixture model is immutable and has no reference-model state. |
| ORC-009 | The model's class labels denote query equality, distinct from the order oracle's instant labels. |
| ORC-010 | Collection cleanup preserves the primary mismatch. Direct index checks own no external resource. |
| ORC-011 | The direct lookup and public scan cross different production paths, but share normalization. Native `.equals()` is the independent semantic calibration; this record does not claim a second full reference model. |
| ORC-012 | This record names the owner, RED controls, limits, and required exact-commit review. |
| ORC-013 | Alias equality versus fixed-offset inequality separates the candidate key from display-only and instant-only keys; forged and shadowed values reject structural impostors. |
| ORC-014 | The Collection uses controlled in-memory sync and ends its claim at the snapshot; no provider handoff is claimed. |

## Limits and exact-commit review

The oracle covers ordinary values from one polyfill copy and one instant.
Other IANA aliases, mixed Temporal implementations, joins, grouping, query
identity, live-query publication, provider paths, and longer histories need
their own witnesses. The `in` oracle adds generated list membership but not
those other boundaries. `Intl` canonicalization has a raw-ID fallback when
the host rejects a valid Temporal zone; alias equivalence in that case is
unproved. A custom comparator that distinguishes two query-equal aliases
also needs a separate law and index witness. Direct D2 `groupBy` has a
separately approved kind-and-string policy.

Pending fresh hostile review of the exact final commit.
