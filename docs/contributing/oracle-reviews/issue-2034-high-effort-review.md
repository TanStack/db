# Temporal persistence review follow-up

Reviewed commit: `6562f8c1ebbb15698e66c98ebe39c440df251984` (PR #2039).
The review supplied ten unverified claims. This record preserves the decisive
observations, the narrow repair, and the remaining work. It does not extend the
approved native-value or multiprocess support contract.

## Observed lifecycle and value boundaries

Controlled probes drove the actual persisted wrapper, Collection, and coordinator:

- Two active demands, with the native demand first or last, reached sequence-gap
  recovery after a leader became a follower. Both orders entered terminal error.
  A later coordinator message caused no additional hydrate or ensure, and another
  load rejected with the same terminal error. Release remained available. A
  native-first demand stops the recovery suffix by the selected fail-stop law;
  it does not leave a ready Collection repeatedly entering gap recovery.
- A controlled applied receipt held a hydrated row visible while leadership
  changed. The load then rejected wire admission. A subsequent targeted change
  removed the cached row, and unload delivered the matching release. Rejection
  does not roll back already-published cache rows; it also does not make them
  permanently immune to invalidation. These observations are limited to the
  controlled component boundary, not a real browser leadership schedule.
- Instant, PlainDateTime, and ZonedDateTime demands loaded twice through a
  recording persistence adapter without a global Temporal constructor. Request
  identity uses the request object; `toStableSerializable` serves persisted
  index specifications, not subset keys.
- Real SQLite queries with PlainDateTime or ZonedDateTime literals succeeded
  through the prior fallback on an empty table and now reject explicitly.
  Instant queries reject without the registered constructor and succeed after
  registration. These are the selected v2 restrictions. Engine-native Chrome
  and polyfill interoperability still require their receiving owner.
- Cold and hydrated local loads preserved the exact upstream error for both
  synchronous throws and promise rejections. Both exposed promises. Coordinated
  native loads failed before invoking the upstream source; scalar controls
  preserved the upstream error. The real wrapper registers any upstream loader
  as a remote owner before it can take that route. The purported local upstream
  failure followed by newly remote retry admission was not a legal path in this
  source/owner configuration.

## Discarded string membership work

The existing boolean-arity owner observed result rows, receiving SQL, bindings,
index plans, and expression visits. It did not observe SQL construction discarded
before the receiving SELECT. Correct output therefore hid unnecessary work.

The repair keeps canonical membership identity for native literals and persisted
index expressions. Runtime membership over ordinary strings no longer constructs
an identity clause that the safe classifier discards.

The owner now checks lists of 0, 1, 32, and 1,025 strings. An independent work rule
allows zero SQL-literal quoting of values carried through the JSON list binding.
The observation counts the quoting primitive for those exact list values, even
when the resulting string never reaches SQLite. Exact result keys and binding
counts remain separate assertions.

Before the repair, the unchanged work assertion failed with 2, 64, and 2,050
quoting operations; the empty-list control passed. After the repair, all four
cases and the original large indexed OR-scope witness passed.

A separate SQL mutation removed the native paired-membership conjunct from a
negated PlainDate membership query. The ISO date and Japanese-calendar date had
one ordering key but different identities. Correct SQL returned the Japanese
row; the mutated SQL returned no rows. Removing the native check is therefore
not a safe simplification, even with residual filtering.

The repair changes one predicate and adds no production state or helper.
Production weight is +3/-1 lines. Tests add four bounded cases plus nearby prose.
This is a construction-work claim, not a measured latency improvement.

## Remaining efficiency and upgrade work

Deterministic counters on an empty real SQLite table measured two native parses
for EQ and twelve for an IN list containing three native elements. The count
includes literal compilation and membership construction, but no row decoding.
The typed-value and expression-index owners retain a follow-up to reuse encoded
literal data without changing validation, calendar identity, or binding limits.
There is no claim here that every parse is removable or that a latency limit was
violated.

Successful follower loads and leader-to-follower loads each performed two wire
projections, including the coordinator's projection. A transient failure produced
four projections across two coordinator attempts. Initial and post-hydration
validation are mutually exclusive. Any future projection reuse must preserve
wire admission at ownership transitions, rather than simply delete guards.
Native wire support remains outside v2; it needs both sending and receiving
protocol behavior and real browser/Electron evidence.

An old-writer/new-adapter probe rebuilt a field-expression index once. It retained
an unchanged raw `row_version` index and performed no rebuild on the next ensure.
A separate old/new Collection index-metadata probe confirmed that native-literal
signatures change while their version remains 1. Installing both signatures
retained two active registry entries. Existing schema/reset paths can remove
obsolete entries; this PR does not promise automatic orphan reclamation.
Applications that retain their cache should expect first-use rebuild work for
changed expressions. A signature-version bump alone would not reclaim old rows.

## Verification and oracle audit

The targeted review probes passed 23 checks after the repair. Eight surrounding
suites passed 563 tests with one existing TODO. TypeScript passed. The focused
string-work test failed on the reviewed implementation and passed after repair.
The native identity mutation failed at the intended candidate-row checkpoint.

For the bounded work extension, ORC-001/002 use the JSON-binding contract and a
separate primitive counter. ORC-003/005 place the law, driver and observations in
the existing owner. ORC-006 is established by the original implementation's
construction counts. ORC-009 uses existing vocabulary. ORC-010 restores the probe
and closes SQLite in cleanup. ORC-012 is this record. ORC-013 covers empty and
nonempty sizes, including one beyond the binding cap. ORC-004/007 do not apply to
this fixed enumeration; no new generated grammar is claimed. ORC-008 introduces
no model state machine. ORC-011's plausible unsafe simplification is challenged
by the independent calendar-membership fixture. ORC-014 claims only Node SQLite
and controlled coordinator boundaries, with native-host ownership still open.

The ten-item disposition audit is: one fixed-now, three refuted as stated, three
duplicates of selected design restrictions, and three deferred investigations.
Each compound claim retains its valid observation even when its claimed
consequence was refuted. No design decision is required to apply the narrow fix.
