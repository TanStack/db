# Bounded deferred-item follow-up

This follow-up starts at `f982b8e04017d82c24ac147c84155858421a5d0b`. The user
requested bounded work on all eight outstanding review items. The table separates
repairs, evidence for the already selected reset policy, and the remaining work.
No native wire support or automatic destructive migration is added.

| Review item | Evidence and change | Disposition |
| --- | --- | --- |
| HE-007, repeated native encoding | EQ previously parsed twice; three-element IN parsed twelve times. Compilation now retains the order and identity from one validated encoding and does not compile an IN list as a discarded scalar. Both native kinds have a 1/3/1,025-occurrence work bound plus the existing semantic suites. | Fixed. Recorded EQ is one parse; three-element IN is three. This is a construction-work result, not a latency claim. |
| HE-008, repeated wire projection | Previous controlled loads observed two projections on success and four across a failed attempt and retry. The coordinator also creates a detached snapshot. A new same-input/later-call witness rejects a global identity-cache mutant at the second snapshot's value assertion. Early admission remains necessary across hydration and role changes. | Open. A bounded inspection found no safe guard deletion or transparent global cache. The persisted/coordinator owners retain validation-only traversal or an explicit prepared-request boundary, including lifecycle references, ownership identity, and receiver checks. Neither design was implemented in this pass. |
| HE-010, obsolete indexes | An explicit schema reset removes both old/current signature entries and physical indexes before reading the new schema, preserves another collection's indexes and rows, and retains the replacement index on same-schema reopen. Skipping registry deletion fails the new test at the registry checkpoint. | Selected reset path verified. Automatic cleanup while preserving old cache contents remains outside the accepted reset policy. |
| HISTORY-002, ambiguous old markers | The reset witness installs frozen old JSON containing an unescaped marker-shaped ordinary record. The first new-schema read is empty; re-seeding with the current writer preserves that record after reopening. | Selected reset path verified. Already-erased types and ambiguous old bytes are not reconstructed. |
| BOUNDARY-004/HISTORY-004, mutable own-tag metadata | A plain own-tag record allowed a returned metadata snapshot to mutate the internal literal. A null-prototype own-tag record failed during createIndex. Both now follow ordinary record serialization and cloning; genuine immutable native values remain native. | Fixed for plain/null-prototype records. Custom-prototype impersonators remain outside the native metadata contract; the existing SQLite owner rejects a false native brand atomically. |
| BOUNDARY-005, signature collisions | A Temporal.Instant and an ordinary `{ __type, value }` record had equal public metadata signatures. Ordinary tagged records now receive an escape envelope. Metadata encodes values once, so generated native tags are not mistaken for user records on a second pass. Twelve fixtures compare every signature pair across equivalent native values, key-order variations, native/tagged pairs, nested mixtures, and the escape envelope. A real persisted wrapper receives the native and ordinary definitions: the old source retains only one physical index, while the repair retains two. | Fixed for the declared literal domain. No claim about function identity or arbitrary custom classes. Ordinary tagged-record signatures can change; the documented reset policy applies. |
| VERIFY-NUL-NOTE, remaining NUL paths | Mixed native/string runtime membership passed. NUL-bearing expression-index creation failed SQL parsing. SQL literals now use escaped JSON extraction when NUL is present, reusing the storage representation without a new host API. Four NUL/Unicode strings cross ordinary/native-mixed lists and positive/negated membership. Tests inspect stored expression values, final keys and candidate containment. | Fixed at the persisted-expression boundary. Existing direct equality and runtime membership coverage remains. |
| CR-003, revival helper kind | The helper and its constructor lookup now accept only `Temporal.Instant` or `Temporal.PlainDate` statically. The decoder already dispatches only those cases. TypeScript verifies the narrower calls. | Static API narrowing complete. No additional runtime behavior or constructor registry is introduced. |

## RED/GREEN and calibration

The seven initial probes produced six failures and one passing mixed-runtime
control. The production createIndex/ensureIndex exceptions are failures at the
requested public boundary, not harness setup failures.

The permanent checks were then run through a loader that substitutes exactly the
pre-fix adapter and Collection index source from the starting commit. The reach
record confirms both originals loaded. Nine tests fail: four NUL index witnesses,
two encoding counters, two ordinary metadata records, and the signature relation.
The genuine-native, explicit-reset and fresh-projection controls pass. No current
production file was replaced during this comparison.

Two additional scratch mutants fail at their intended assertions:

- Omit registry deletion during reset: two obsolete rows remain instead of none.
- Cache wire projections globally by input identity: the next projection retains
  the previous value instead of observing the next call's input.

Those mutations do not change current production. They prove the new checks
reject those particular wrong designs, not every possible migration or cache.
The final surrounding run, type check, and lint result are appended below.

## Test gaps and boundaries

The old expression-index fixtures covered runtime NUL bindings but omitted NUL
inside index literals. Existing native rank/text tests observed semantics but
not repeated compilation work. Metadata tests covered equivalent definitions
without ordinary records shaped like native tags or mutation through returned
own-tag snapshots. Those missing distinctions are now executable.

The Collection index-value oracle owns an independent fixture-equivalence and
snapshot-isolation law. The existing typed-value, expression-index, resume and
persisted owners receive the other additions. This is one new oracle owner,
plus extensions to four existing owners; it is not five new models.

ORC-001/002/003/005 use the public metadata/snapshot, literal preservation and
selected reset laws, independent fixture classes/keys and explicit checkpoints.
ORC-004/007/008 do not apply to these fixed bounded histories; no new random
campaign or stateful reference model is claimed. The new metadata owner joins
the package oracle command. ORC-006 is demonstrated by original-source RED and
the two reached mutants. ORC-009 retains existing terms. ORC-010 uses Vitest
teardown or the existing failure-preserving cleanup. ORC-011 has no new shared
semantic-model hypothesis; stored index values separately expose DDL results
before residual filtering. ORC-013 uses neighboring NUL positions, ordinary/native
pairs, key order, another collection, and a same-schema reopen. ORC-014 claims
only the tested Node SQLite and controlled wire boundaries, not native browser,
Electron, or mobile receiving behavior. This record supplies ORC-012 evidence.

The bounded audit accounts for all eight items: five fixes, two verified uses of
the selected reset policy, one open efficiency item with a concrete design
boundary and owner. It does not convert that open item into a refutation.

## Final verification and code weight

Nine affected suites pass 575 tests with zero failures and one existing TODO.
A final receiving witness added afterward passes separately: both public index
requests retain distinct registry entries and physical indexes. The same witness
fails against the original Collection index source (one index instead of two).
TypeScript passes. Changed-file ESLint has zero errors and 22 pre-existing
require-await warnings in the persisted owner. The new code adds no lint warnings.
The actual Prettier CLI and `git diff --check` pass.

Production changes add 56 lines and remove 34 (net +22), with no persistent cache,
new retry state, or automatic reset. Tests add 380 lines across five test files;
one new oracle owner is registered with the existing package oracle command.
Documentation and the changeset record the fixes and remaining projection work.

Local receipts: `temporal-bounded-owner-final-red.json` (nine reached original
failures), `temporal-bounded-final-surrounding.json` (575 passed, one TODO),
`temporal-bounded-signature-receiver-{red,green}.json` (one index versus two),
`temporal-bounded-reset-mutant-red.json` and
`temporal-bounded-projection-mutant-red.json` (one intended assertion failure
each). All are under `/private/tmp`; the laws, bounds, observed results and limits
are preserved in this versioned record and the executable owners.

## Subsequent HE-008 repair

The [validation-work follow-up](issue-2034-wire-validation-work.md) supersedes
HE-008's open disposition above. Its oracle was red before the repair. Shared
validation-only traversal removes discarded snapshots while retaining admission,
receiver validation, detached output, and local lifecycle identity. The historical
bounded-pass verdict remains unchanged as evidence of what that pass established.
