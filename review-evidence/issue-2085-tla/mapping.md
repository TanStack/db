# Model-to-production mapping and limits

The model is a reference account of promised observations. It does not import
production helpers or classify their responses to decide expected behavior.
Its single record `s` combines per-Collection coordinator state, durable
SQLite state, one source applied receipt, and C's public row. That combination
does not correspond to one production object.

| Model action or state                      | Production boundary                                                                                                                                                                                                                      | Receiving evidence                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `SendX`, `anchorVersion`, `anchorEpoch`    | `PersistedSyncManager.persistAndBroadcastExternalSyncTransactionUnsafe` in `packages/db-sqlite-persistence-core/src/persisted.ts` captures the durable anchor before the source RPC.                                                     | `persisted-oracle.test.ts` checks the held receipt.                                                                     |
| `OriginalApply`, durable row, ID, position | `BroadcastCollectionCoordinator.applyDurablyAtNextStreamPosition` and `SQLiteCorePersistenceAdapter.applyCommittedTxInternal`. One model step stands for the writer-lock and SQLite-transaction cut.                                     | `sqlite-core-adapter-oracle.test.ts` checks real SQLite rows, metadata, and exact IDs.                                  |
| `CloseA`, `ElectB`, heartbeat queue        | `BroadcastCollectionCoordinator.acquireLeadership` reserves a term through `reserveLeadershipTerm` before `emitHeartbeat`; `onChannelMessage` receives it.                                                                               | `browser-coordinator-oracle.test.ts` and `leader-close-oracle.opfs.spec.ts` check controlled and Chromium routes.       |
| `PeerWrite`                                | A later committed transaction under B's writer route, including same-key overwrite and metadata/cursor consequences that the row-only model abstracts away.                                                                              | SQLite adapter and OPFS receiving oracles.                                                                              |
| `PruneX`                                   | `applied_tx` retention in the SQLite adapter. The model has no age or row-count clock; this step stands for a legal later retention cut.                                                                                                 | SQLite adapter oracle checks pruned-ID reconciliation.                                                                  |
| `Reset`                                    | SQLite schema-reset epoch and the wrapper's accepted `collection:reset` envelope. The model permits a synthetic signal; the built-in coordinator currently emits none.                                                                   | SQLite adapter reset tests and controlled `persisted-oracle.test.ts` reset histories.                                   |
| `Reconcile`                                | `BroadcastCollectionCoordinator.handleReconcileCommittedTx` schedules the writer lock; `SQLiteCorePersistenceAdapter.reconcileCommittedTxUnscheduled` checks exact ID, durable row version, and reset epoch inside SQLite's transaction. | SQLite adapter and Browser coordinator oracles; Electron IPC has its own bridge witness.                                |
| `SettleReceipt`, `resumePosition`          | `PersistedSyncManager.recordDurableSourceCommit` and its wrapped applied receipt. The model stores X's own position; a later position read can invalidate owned resume evidence.                                                         | Persisted wrapper owner checks same-run settlement; the exact-ID plus peer-write plus resume-binding join remains open. |
| `ObservePosition`                          | `loadResumeSnapshot(includeRows: false)` and `bindResumeSnapshotEvidence`. It changes observed position, not publicly applied rows.                                                                                                      | Persisted wrapper position-only certification history.                                                                  |
| `DeliverNotice`, C's public row and events | `processCommittedTxUnsafe`, `invalidateFromCommittedTxUnsafe`, and `reloadActiveSubsetsUnsafe`. The model's semantic notice epoch is not on the production commit envelope.                                                              | Persisted wrapper owner checks row/publication cuts; Chromium/OPFS owner checks real cross-tab delivery.                |

The model's `cPublic` is one keyed source-row projection. It does not
calculate a mounted live-query Collection. The existing persisted wrapper and
real OPFS owners check source and live-query rows at their named checkpoints.

## Independent laws and mutant discrimination

| Law                                                                              | Source authority                         | Distinguishing experiment                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Durable election term increases even without a write.                            | Coordinator contract and glossary.       | `reuseTerm` changes B's reserved term to 1. `DurableTermUnique` fails at election; with that invariant omitted, B heartbeat then delayed A heartbeat fails `SuccessorRouteStable` at C.          |
| Present exact ID wins over a changed anchor and reports its original position.   | Coordinator contract.                    | X at version 1, Y at version 2, then reconcile. `anchorFirst` rejects X; `latestReceipt` misattributes version 2.                                                                                |
| Absent ID requires unchanged row version and reset epoch.                        | Coordinator contract.                    | Y before reconciliation and a reset that returns the version to zero. `ignoreAnchor` and `ignoreEpoch` fail at the writer-lock cut. `retainStaleLedger` fails the same-epoch acknowledgment law. |
| A pruned ID cannot authorize replay.                                             | SQLite retention and anchor contract.    | X commits, is pruned, then reconciliation returns unknown; the reachability control proves that path exists.                                                                                     |
| A reconciliation reload repairs C despite equal observed position.               | Coordinator contract and glossary.       | C observes position 1 but misses X's row. `dropEqualReload` fails at the public reload checkpoint; `noReconcileNotice` fails at the notification cut.                                            |
| A reset-known peer does not publish an old-epoch row.                            | Controlled wrapper reset contract.       | Reset signal reaches C before delayed X notice. `trustStaleNotice` fails at the public row.                                                                                                      |
| Position-only observation and unchanged reload do not publish extra rows/events. | Glossary and persisted wrapper contract. | `publishOnObserve` and `duplicateReloadEvent` fail at their public checkpoints.                                                                                                                  |

The `challenge-pre-signal-reset` counterexample is deliberately separate:
it attacks a proposed law whose authority is unresolved. Its cut precedes C's
reset signal. The model does not turn that counterexample into a product
expectation or change an oracle assertion to hide it.

## Production refinement still needed

TLC checks this finite reference system. It does not compare a TypeScript trace
with the reference state. The existing owners compare production paths and
public observations for several partitions, as recorded in
`docs/contributing/oracle-coverage.md`. Two joined paths remain:

1. The controlled persisted-wrapper owner now exercises exact X after
   same-key Y through its owned resume-evidence binding. It checks the
   original-position response and incompatible later generation. A temporary
   latest-position response fails that public evidence assertion. The real
   SQLite adapter's exact-ID decision is separately covered; the joined
   real-adapter wrapper history remains open.
2. Missed X notice, empty durable term reservation, and passive C's later
   public rows in one real Browser/OPFS schedule.

If a built-in cross-tab reset sender is added, a third decision is needed:
what public safety, if any, is promised before C receives the reset signal.
A real-host witness must then drive that specific signal order.
