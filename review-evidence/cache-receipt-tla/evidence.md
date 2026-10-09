# Evidence layer — TLC and production boundary

All TLC runs used the pinned `field-lab-tlc:local` image with TLA+ 1.7.4,
TLC 2.19, and Temurin 21.0.12. From this directory:

```sh
docker run --rm --volume "$PWD:/work:ro" field-lab-tlc:local \
  -workers 4 -deadlock -metadir /tmp/tlc -config safe.cfg ReceiptSettlement
```

`-deadlock` permits terminal histories and the documented own-demand
self-wait. It does not add fairness or prove eventual settlement. The checked
TLA+ file hash is in [process.md](process.md).

| Configuration                | TLC result                                                                  | Distinguishing observation                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safe.cfg`                   | 42 generated, **30 distinct** states, depth 10; all safety invariants pass. | A pending ordinary write has no acceptance signal; truncate and fresh receipt effects match the exposed authoritative base.                                         |
| `safe-no-optimistic.cfg`     | 17 generated, **16 distinct** states; all safety invariants pass.           | Without an optimistic hold, ordinary writes apply immediately.                                                                                                      |
| `safe-visibility-gate.cfg`   | 42 generated, **30 distinct** states; all safety invariants pass.           | Waiting for visibility instead of acceptance changes no state while truncate application is immediate.                                                              |
| `fault-held-truncate.cfg`    | Expected `TruncateVisibleOnAcceptance` failure.                             | `AcceptPre → StartRecovery → AcceptTruncate` leaves the truncate accepted but invisible.                                                                            |
| `fault-recovery-cycle.cfg`   | Expected `RecoveryCanFinishAfterTruncate` failure.                          | `StartRecovery → AcceptTruncate` holds the truncate and waits for its visibility; the handler that could release it is waiting for recovery.                        |
| `fault-early-demand.cfg`     | Expected `DemandSuccessHasAppliedEvidence` failure.                         | `StartRecovery → AcceptTruncate → FinishRecovery → StartDemand → AcceptFresh → SettleDemand` succeeds on acceptance while the applied receipt is pending.           |
| `fault-late-acceptance.cfg`  | Expected `AcceptedSignalFollowsAcceptance` failure.                         | An accepted ordinary write does not settle `whenSyncAccepted`.                                                                                                      |
| `fault-early-acceptance.cfg` | Expected `AcceptedSignalFollowsAcceptance` failure.                         | A pending pre-acceptance write incorrectly settles `whenSyncAccepted`.                                                                                              |
| `fault-retained-pre.cfg`     | Expected `VisibleBaseFollowsLatest` failure.                                | A visible truncate leaves the preceding accepted row in the exposed authoritative base.                                                                             |
| `fault-missing-fresh.cfg`    | Expected `VisibleBaseFollowsLatest` failure.                                | A fresh applied receipt fulfills while its row is absent from the exposed authoritative base.                                                                       |
| `cover-self-demand.cfg`      | Expected reachability counterexample to `SelfDemandCycleUnreachable`.       | The handler starts its own demand, whose fresh write is accepted and held by that same persisting transaction. This is a known self-wait, not a safe-model failure. |

The source contract is explicit at two production cuts. Core's
`commitNextPendingTransactionBatch` applies a committed truncate at once even
while an optimistic transaction persists
(`packages/db/src/collection/state.ts:1077-1103`). Scoped recovery calls
`syncControls.truncate()` and waits for `whenSyncAccepted(applied)`
(`packages/db-sqlite-persistence-core/src/persisted.ts:2193-2205`). The
optimistic-history oracle independently checks accepted ordinary transactions,
held applied receipts, and the self-wait boundary
(`packages/db/tests/optimistic-history-oracle.ts`). The Electric applied-
settlement owner checks subset success after visibility. This model does not
rerun the Electric path. The existing optimistic settlement-boundaries oracle
ran alongside this model and passed **18/18** tests.

The new mixed-order receiving oracle in
`packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`
exercises a different authority boundary. It checks an empty source subset
before a fresh row and preserves the warm peer's resume metadata while the
private generation receives a reset marker. Its correct full-file production
run passed 65/65 tests.
A temporary production mutant changed the rotation's head test from the
transaction-time live `claimedPhysicalId` to `claimed[0]?.physical_id`.
The new oracle reached its head comparison and failed as an **assertion
failure**, not a timeout or setup failure. The mutant was removed. This
calibrates the composed cache-authority witness; it does not validate this
receipt model against a new production driver.
