# Hostile failure assay — C1

A fresh auditor received only [C1](candidate.md), its source basis, and the
instruction to assume failure. It did not receive sibling forms, a preferred
outcome, or the fracture/tension readings. It verified production revision
`e21c280f3c4e56f6c0d05ec0eed87db29c623489`. No candidate implementation exists.
The five findings below are unranked conditions, not a claim that every coherent
implementation of C1 fails. Source line numbers refer to that revision.

## HA1 — Index literals can disappear upstream of the adapter

**Broken claim:** C1 §3 requires agreement between runtime literals and persisted
index expressions. The wrapper independently serializes index expressions
through `toStableSerializable` (`src/persisted.ts:1134`), which reduces Temporal
objects to their enumerable fields. `buildPersistedIndexSpec` uses that result
(`:3785`). Both tested polyfill kinds have no enumerable fields. A correct row
codec and compiler cannot recover an index literal already reduced to `{}`.

**Evidence:** source-backed, with the empty-field premise observed in a
standalone probe. The repaired wrapper path remains unresolved. The Node
expression-index oracle constructs specifications itself and calls the adapter
directly (`tests/expression-index-oracle.test.ts:505`), so expanding only its
literal domain misses this boundary.

**Repair condition and disposition:** include the wrapper's specification
boundary wherever literal-bearing indexes are claimed. Preserve or explicitly
reject Temporal literals there, and test wrapper-created specifications through
captured SQL and the planner. Direct-adapter results alone cannot discharge this
obligation.

## HA2 — Extending the oracle can reproduce the corruption in its model

**Broken claim:** C1 §6 relies on existing owners to prove preservation through
action folding and rollback. The ordinary-work owner clones values using
`structuredClone` (`tests/ordinary-transaction-work-oracle.ts:97`). On Node
24.19.0 with temporal-polyfill 0.3.0, a standalone probe converted both Instant
and PlainDate into unbranded empty objects.

**Evidence:** observed clone behavior, not a violation of the existing oracle,
whose row domain is string/number. Merely widening its inputs would make the
model discard the information that the extension must protect. A value-erasing
implementation could agree with that corrupted reference at durable checkpoints.

**Repair condition and disposition:** retain the existing owner, but give its
new value domain independent intrinsic kind/value observations. Check successful
writes, rollback, replay and reopen where owned, and demonstrate rejection of a
value-erasing wrong design. Existing clone/comparison assumptions cannot transfer
unchanged.

## HA3 — Candidate containment alone does not settle query outcomes

**Broken claim:** C1 §3 promises existing query semantics while permitting
conservative SQL selection. SQL removes rows before the residual evaluator runs
(`src/sqlite-core-adapter.ts:2448`). DB ordering throws when two Temporal operands
have different kinds (`packages/db/src/utils/comparison.ts:310`). Preserving
every row for which a predicate returns TRUE does not establish what happens to
rows whose evaluation rejects. Negating an overapproximation also reverses its
containment direction; the current compiler directly composes `NOT`
(`src/sqlite-core-adapter.ts:905`).

**Evidence:** source-backed premises and constructed defeaters, not executed C1
failures. A decisive witness would show residual-only rejection becoming a
fulfilled result, or a negated conservative leaf losing a matching key. The
witness needs correctly encoded values so corruption cannot explain the result.

**Repair condition and disposition:** define admissibility for partial
evaluations and complete Boolean expressions, and compare outcomes as well as
keys. C1's open SQL classifier includes an observation-contract decision; this
reading does not invent an unconditional requirement to evaluate every branch
or row. Whole-predicate residual execution can discharge some cases, subject to
the separately open cost requirement. Frozen I4 is necessary, not sufficient for
the full semantic claim.

## HA4 — A format fence can invoke destructive reset semantics

**Claim at risk:** preservation of existing durable data under a format rollout.
C1 explicitly leaves old-reader compatibility open; it has not promised a
reversible rollout. The additional constraint is that the available schema
mechanism is not a neutral codec-version fence. Its default is
`sync-present-reset` (`src/sqlite-core-adapter.ts:1284`). Mismatch handling deletes
rows, tombstones, replay records, index registry entries and collection metadata,
then resets the position (`:2827`). Leaving the encoding unversioned instead
lets an old decoder treat an unfamiliar Temporal marker as an ordinary record
(`:306`).

**Evidence:** source-backed mechanisms; applying them to a Temporal rollout is a
constructed scenario. This is a conditional implementation failure, not a
refutation of C1's acknowledged open compatibility policy.

**Repair condition and disposition:** decide and witness upgrade/downgrade
behavior for retained bytes, including metadata and replay, before selecting a
fence. An incompatible reader must not silently reinterpret values or trigger
an unintended reset. Existing physical-index rebuilding does not establish
value-format compatibility. Migration evidence remains unresolved.

## HA5 — Excluded wire values need admission behavior

**Broken claim:** C1 §5 permits excluding coordinator support while preserving
existing ownership/work behavior. Temporal has no wire-domain case; custom
prototypes fail projection (`src/remote-subset-wire.ts:702`). For reachable
non-single-process demand, a failed coordinator request is queued again; the
queue retains failures and schedules another retry (`src/persisted.ts:1901`,
`:3293`). Permanent unsupported input differs from a transient transport failure.

**Evidence:** source-backed with an unresolved receiving witness. The ordinary
wrapper route bypasses these coordinator queues for `SingleProcessCoordinator`
(`:3238`). That coordinator's separately callable projection method does not
prove every single-process wrapper query fails. This qualifies the reach implied
by E8 and the frozen ownership table; it does not expand the support claim.

**Repair condition and disposition:** either prove supported transport/receipt
paths, or make excluded operations observably inadmissible without perpetual
retry or retained demand. Documentation alone does not specify this behavior.
The wrapper/coordinator owner needs a receiving witness while demand is retained
and after release/abort. This does not justify a replacement retry lifecycle.

## Concrete failure scene

Create an index through the wrapper on `coalesce(when, I)`, where `I` is an
Instant and one row has `when: null`. Assume C1's row codec and direct-adapter
compiler are correct. If the wrapper's current specification serializer remains,
it sends `{}` in place of `I`. The receiving compiler cannot reconstruct the
intended expression. Runtime and index SQL diverge, or index creation rejects.
The wrapper can log index-creation failure while continuing
(`src/persisted.ts:3813`). Final row tests may pass through fallback while the
claimed index contract fails.

This scene is constructed from verified source, not executed against a C1
implementation. Its decisive checkpoint is the wrapper-emitted specification,
then actual normalized SQL and named-index use.

## Controls, evidence boundaries and recording

The auditor read the candidate, source trace, applicable repository guidance,
oracle guide and relevant owner limits. It did not read sibling designs or edit
repository files. Standalone probes established polyfill behavior only. Another
probe found ISO- and Gregorian-calendar PlainDates that compare equal but retain
different strings; the current two-day oracle explicitly excludes calendar
variation (`tests/sqlite-temporal-value-oracle.test.ts:33`). No repaired adapter,
native-host, cross-process, crash or performance result follows.

Paths beginning `src/` or `tests/` above are under
`packages/db-sqlite-persistence-core/`, except the explicitly identified Node
expression-index owner. Full owner mapping is in [evidence.md](evidence.md).

The primary agent checked the cited serializer, cloning, comparison, routing,
retry and reset mechanisms. This record preserves all five returned attacks,
their evidence classifications, the concrete scene and the controls. It narrows
HA4 to the compatibility condition C1 actually leaves open and makes the
SingleProcess routing qualification explicit. No frozen grammar rule was
silently revised and no finding is ranked.

**Induced distortion:** assuming failure can turn every unresolved detail into
an apparent architectural defect. These are necessary conditions and receiving
evidence obligations. Broad residual execution or an enforced narrower scope
can discharge some of them; that is not evidence they are already discharged.
