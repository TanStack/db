# Evidence layer — TLC and source reconciliation

All runs used the pinned field-lab Docker image: TLA+ 1.7.4, TLC 2.19,
Temurin 21.0.12. The container smoke check passed both its safe and weakened
controls. TLC commands have this form from this directory:

```sh
docker run --rm --volume "$PWD:/work:ro" field-lab-tlc:local \
  -workers 4 -deadlock -metadir /tmp/tlc -config safe.cfg CacheAuthority
```

`-deadlock` disables TLC's deadlock report because the bounded grammar has
legal terminal states. It does **not** add fairness or establish liveness.
The checked `CacheAuthority.tla` SHA-256 is recorded in [process.md](process.md).

| Config                            | Bound and result                                                                                                                              | Decisive cut                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safe.cfg`                        | Two runs, one possible new generation and one loss per run: 1,192,769 generated / **338,940 distinct**, depth 19; all listed invariants pass. | Warm peer, claim expiry, reads, fetches, settlement, and partial evidence.                                                                           |
| `safe-overlap.cfg`                | A can have two loss events and two new generations while B stays warm: 22,717 / **10,653 distinct**, depth 15; all listed invariants pass.    | Two provider sessions and the final replacement.                                                                                                     |
| `challenge-expired-head.cfg`      | Mixed evidence and expiry, 17,237 / **8,010 distinct**; `ExpiredClaimCannotAdvanceHead` passes.                                               | The claim is checked at rotation, not when evidence was first seen.                                                                                  |
| `cover-middle-session.cfg`        | Expected reachability counterexample, depth 9.                                                                                                | Expire → recover → start middle fetch → expire → recover → deliver middle fetch; the job is ignored. This is a coverage probe, not a safety failure. |
| `fault-late-fetch.cfg`            | Expected `NoStalePublication` violation, depth 7.                                                                                             | An old fetch arrives after new storage is claimed.                                                                                                   |
| `fault-late-read.cfg`             | Expected `NoStalePublication` violation, depth 5.                                                                                             | A read begins with a valid claim, expires while awaited, then publishes.                                                                             |
| `fault-global-clear.cfg`          | Expected `WarmPeerSurvivesPrivateRecovery` violation, depth 4.                                                                                | A's expiry rotation clears B's public row.                                                                                                           |
| `fault-partial-certification.cfg` | Expected `PartialSubsetDoesNotCertifyGeneration` violation, depth 6.                                                                          | One fresh subset write falsely certifies the whole cache.                                                                                            |
| `fault-reuse-cache.cfg`           | Expected `SuccessfulDemandHasEvidence` violation, depth 6.                                                                                    | Post-rotation cached success settles with no fresh row.                                                                                              |
| `fault-pending-restart.cfg`       | Expected `FailedRestartSettlesDemand` violation, depth 5.                                                                                     | Restart fails while the caller remains pending.                                                                                                      |
| `fault-invalidation-gap.cfg`      | Expected `NoStalePublication` violation, depth 5.                                                                                             | Source evidence is invalidated while the claim is live; an old fetch arrives before retirement begins.                                               |
| `fault-expired-head.cfg`          | Expected `ExpiredClaimCannotAdvanceHead` violation, depth 5.                                                                                  | Incompatible evidence and expiry precede a rotation that wrongly moves the head.                                                                     |

The shortest decisive TLC action traces make the ordering explicit. The
reachability probe intentionally negates the state it seeks, so its reported
invariant violation is a successful coverage result.

| Control                      | Actions after the initial state                                                                                                         | Observation at the final state                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fault-expired-head.cfg`     | `InvalidateResume(A) → Expire(A) → BeginRecovery(A) → FinishRecovery(A)`                                                                | The expired run advances the shared head, violating `ExpiredClaimCannotAdvanceHead`.                          |
| `fault-invalidation-gap.cfg` | `Request(A) → StartFetch(A) → InvalidateResume(A) → DeliverFetch(A)`                                                                    | Old evidence publishes and settles a demand before provider retirement begins.                                |
| `fault-late-read.cfg`        | `Request(A) → StartRead(A) → Expire(A) → FinishRead(A)`                                                                                 | A read admitted under a live claim publishes after that claim expires.                                        |
| `fault-late-fetch.cfg`       | `Request(A) → StartFetch(A) → Expire(A) → BeginRecovery(A) → FinishRecovery(A) → DeliverFetch(A)`                                       | An old provider result publishes under replacement storage.                                                   |
| `cover-middle-session.cfg`   | `Expire(A) → BeginRecovery(A) → FinishRecovery(A) → StartFetch(A) → Expire(A) → BeginRecovery(A) → FinishRecovery(A) → DeliverFetch(A)` | The first replacement session's late result is reached and ignored after a second distinct loss and rotation. |

The originally drafted safe model failed the new expired-head invariant with
`InvalidateResume → Expire → BeginRecovery → FinishRecovery`. The checked
SQLite implementation already has the necessary transaction-time condition:
`claimedPhysicalId` is defined only for a claim whose expiry exceeds `now`,
and only `claimedPhysicalId === active.physical_id` retires the head
(`packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts:1702-1770`).
The model was corrected; this was **not** a production RED result. The
persisted SQLite oracle already had an expired-head witness at
`packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts:1003`.
The later receiving addendum below combines recovery entry, expiry, a warm
peer, and fresh public/durable settlement.

The model's old read-admission action also initially permitted a read to begin
after expiry. That was an encoding error. The final `StartRead` requires a live
claim and trusted resume evidence, so the late-read mutant reaches expiry
**between** admission and completion. The first overlap reachability result
was likewise rejected as a false-green grammar result: an uncertified cache
was able to trigger a phantom second recovery. Event counters corrected it.
`InvalidateResume` denotes entry to the wrapper's quarantine boundary. The
model does not prove that every upstream provider signal reaches that entry
synchronously; the existing controlled Electric owner covers its selected
message schedules.

## Subsequent receiving-oracle addendum

The source snapshot for this addendum is still Git
`d3d617273318573df9e15287d704dc1853a67337`; the new test is the working
diff in `packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`.
The controlled source calls `startScopedRecovery` while its claim is live. The
driver holds the real SQLite rotation before its transaction, advances the
adapter clock beyond that claim's expiry, and keeps a second Collection's
claim live. After rotation, an empty subset load must leave the recovering
Collection and its private durable rows empty. A subsequent fresh subset load
compares the shared head, a later claim, both public Collections, both claimed
SQLite row snapshots, and their separate resume metadata. The independent
rule expects private empty storage with a reset marker for the expired run and
the original current storage with unchanged resume metadata for the warm peer
and later claimant.

The full oracle file passed **65/65 tests** with production code. A temporary
mutant replaced `claimedPhysicalId === active.physical_id` with
`claimed[0]?.physical_id === active.physical_id`. The targeted test failed as
an **assertion failure at the shared-head comparison** after reaching held
rotation; it was neither a timeout nor a setup failure. The mutant was removed.
The test supplies recovery entry through a controlled source. It does not
prove that Electric classifies malformed resume evidence and reaches that
entry before a concurrent claim expires.

| Guide requirement | Outcome for this fixed receiving witness                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001           | The law is claim authority at SQLite rotation; the test comment states source, observations, and controlled-source limit.                                           |
| ORC-002           | Expected storage separation follows from per-run claim authority, not the adapter's `claimedPhysicalId` branch.                                                     |
| ORC-003           | Opening oracle prose plus adjacent test prose distinguish law, two-event history, real driver, observations, and post-demand checkpoint.                            |
| ORC-004           | Not triggered: this is a fixed distinguishing history, not a generated-history claim.                                                                               |
| ORC-005           | `startScopedRecovery`, real `SQLiteCorePersistenceAdapter`, two public Collections, SQLite snapshots, and the held-rotation reach gate all run.                     |
| ORC-006           | The expired-physical-ID mutant fails the intended head assertion.                                                                                                   |
| ORC-007           | Not triggered: no important generated property was added.                                                                                                           |
| ORC-008           | Not triggered by the fixed test: it adds no stateful reference model. The separate TLA grammar records its own state distinctions.                                  |
| ORC-009           | Test and model use glossary terms; the TLA `live` Boolean maps to persisted cache claim validity, while the controlled source represents recovery entry.            |
| ORC-010           | The test releases the rotation gate and bounds recovery and cleanup waits; a primary checkpoint error remains visible even if cleanup fails.                        |
| ORC-011           | The test checks both direct head identity and the independent new-claim/peer-row consequence; the earlier adapter-only expiry witness is a neighboring formulation. |
| ORC-012           | This addendum records applicability, results, and the remaining provider handoff against the named source snapshot.                                                 |
| ORC-013           | The mixed expiry witness rejects the old-physical-ID rule; the existing live-claim rotation witness checks the opposite ownership case.                             |
| ORC-014           | Controlled source recovery entry is explicit. Electric's own invalid-resume-to-entry ordering remains with its receiving owner in the coverage map.                 |

The closure claim is narrow: controlled recovery entry × expiry before the
SQLite rotation transaction × one warm peer × empty and fresh subset loads ×
public and durable rows and metadata at settlement. Electric's upstream
classification, the interval between storage rotation and public truncate,
native hosts, and arbitrary overlapping recoveries are outside this receiving
witness.

## Electric and SQLite receiving completion

The follow-up source begins at Git `5627eadf810b1e507f809ced17e3b7bccfac215c`.
The Electric resume-race owner now supplies the upstream decision that the
controlled SQLite source omitted. A stored resume record belongs to a warm
peer's shape, while a second Electric Collection requests a different shape.
Electric itself chooses scoped recovery. The driver holds rotation before its
SQLite transaction, expires only the recovering claim, and checks that the
warm peer's public and durable row and resume metadata survive. It then starts
a demand while rotation has completed but public truncate has not, and
requires a fresh subset row in private storage after settlement. With the
original production branch, the test failed **at the pre-rotation warm
metadata assertion**: Electric had already written a reset marker to the
shared generation. The fix leaves that marker for the rotated generation.

A neighboring real-SQLite test starts with an active Electric provider
session, then expires its cache claim. It holds rotation after the SQLite
transaction but before public truncate, delivers a retired callback, and
starts a distinct demand at that held cut. The old public snapshot remains
until truncate; the new private storage remains empty. The replacement session
refetches the already-active empty subset, then serves the pre-rotation demand
and the demand started in the gap with separate applied rows. Both demands
remain pending at the held cut, and the gap demand remains pending until its
own snapshot is delivered. Only the two fresh rows appear in the public
Collection and private SQLite snapshot. The test also sends the retired
callback after replacement subscription and checks it is ignored. A temporary
mutant that skipped old session cleanup **survived** this witness because the wrapper's scoped
recovery guard and Electric's lifecycle fence independently excluded those
callbacks. That survivor limits attribution to either individual guard; it
does not negate the observed cross-boundary outcome. The existing descriptor
oracle and `fault-late-fetch.cfg` challenge stale-session admission on their
separate abstractions. A broader lifecycle-guard mutant was rejected by
automatic approval review and was not run.

A wrong-result control wrote retired row 9 directly into the rotated claim
after the held callback. The test failed at its private SQLite snapshot
comparison: expected `[]`, observed row 9. The control was removed. This
calibrates that storage observation, not the relative necessity of each
production fence. In the incompatible-resume witness, the source snapshot
promise stayed pending for an additional event-loop turn after request launch;
the recovering demand remained pending and its row was absent from public and
durable state until delivery.

The repaired branch passed the two receiving tests and the five focused
Electric and SQLite test files: 886 passed, one TODO. Electric typecheck,
changed-file lint, formatting, and diff checks passed. The wrong-result
control's assertion failure is separate from that GREEN result.

| Guide requirement | Outcome for the Electric and SQLite receiving witnesses                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001           | The law is per-run cache-claim authority and source-applied demand settlement; the comments limit provider framing to controlled callbacks.                                                                |
| ORC-002           | Expected warm/private rows and metadata follow from per-run claim ownership and source snapshots, not Electric's classifier or SQLite's head branch.                                                       |
| ORC-003           | Adjacent prose states the laws, two schedules, real entry paths, public/durable observations, and checkpoints.                                                                                             |
| ORC-004           | Not triggered: these are fixed schedules, not generated-history claims.                                                                                                                                    |
| ORC-005           | Electric's actual startup classifier and later provider-session restart, the persisted wrapper, and real SQLite execute at both gated rotation cuts.                                                       |
| ORC-006           | Original code failed warm metadata; injected row 9 failed private-storage assertion. Old-cleanup mutant survived because another guard excluded the callback.                                              |
| ORC-007           | Not triggered: no important generated property was added.                                                                                                                                                  |
| ORC-008           | Not triggered: the tests add no stateful reference model. The TLA grammar's combined rotation/truncate remains a declared abstraction.                                                                     |
| ORC-009           | Tests use the glossary's sync run, provider session, persisted cache claim/generation, public snapshot, and applied settlement terms.                                                                      |
| ORC-010           | Gates and snapshot waits are released in cleanup; timeout-bounded cleanup failures are retained beside the primary checkpoint.                                                                             |
| ORC-011           | The controlled SQLite peer test and the Electric-classifier test independently reach the same private-head consequence; the later expiry test reaches the intermediate cut.                                |
| ORC-012           | This addendum records all applicable requirements, RED/GREEN evidence, the surviving mutant, and the controlled-provider limit.                                                                            |
| ORC-013           | Live-claim head rotation remains the neighboring opposite-ownership witness; these tests cross expiry before rotation and after an active session.                                                         |
| ORC-014           | ShapeStream callbacks are controlled. The installed-SDK delivery owner covers late HTTP responses across managed rotation, but this exact intermediate cut is not an installed-SDK or native-host receipt. |

The named gaps from the earlier addendum are closed at Electric's classifier
and the real-SQLite post-rotation boundary. The bounded model remains an
atomic projection. Live Electric service framing, installed-SDK delivery at
this exact held cut, native SQLite hosts, and arbitrary schedules remain
outside these fixed witnesses.
