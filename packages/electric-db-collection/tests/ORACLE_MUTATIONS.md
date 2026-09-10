# Electric oracle mutation ledger

Run each mutation alone from `packages/electric-db-collection`, confirm the
named test fails, then restore the source before trying the next mutation.
The baseline command is:

```sh
pnpm test:oracles
```

## 1. Collection-local evidence

In `src/electric.ts`, replace `consumeDescriptorLifecycle()` with
`descriptorLifecycle` when a bound sync is created.

Killed by: `binds sync metadata import and export to the receiving collection`. The generated process grammar creates fresh descriptors; it
does not prove shared-descriptor isolation. The descriptor-isolation suite
also crosses raw/once-spread reuse, eager/lazy startup, equal keys, and peer
reset/cleanup.

## 2. Stale callback isolation

In `src/electric.ts`, remove the active-lifecycle term from either
`processMessages` lifecycle guard.

Killed by: `settles every startup, hydration, snapshot availability, commit, and cleanup permutation` and `keeps stream cleanup and stale callbacks scoped to their lifecycle`.

## 3. Acknowledgement liveness

In `src/electric.ts`, delay `seenTxids`, `seenSnapshots`, and matched-message
publication until a pending applied receipt resolves.

Killed by: `txid tracking > should simulate the complete flow` and the
direct-persistence-handler flow tests. Those handlers must receive stream
acknowledgement before the parked optimistic transaction can finish.

## 4. Durable convergence

In `runPersistedTrace` in `electric-oracle.property.test.ts`, make the
wrapped `applyCommittedTx` resolve without calling the saved adapter method.

Killed by: `denotational reference, Electric, persisted Electric, and query adapters converge across controls and publication epochs`.

## 5. Late match evidence

Clear committed match messages when the next change-bearing batch starts.

Killed by: `keeps committed match evidence across newer writer batches`.
The paired `clears committed match evidence when the stream must refetch`
test prevents the opposite error of retaining evidence across a reset.

## 6. Applied baseline and pending presence

In `processMessages`, remove the `syncedData.has(rowId)` fallback from
`hasKnownRow` (replace the fallback with `false`).

Killed by: `independent persistence publications and stream deltas agree with complete-row state`
and `applies on-demand catch-up updates to hydrated persisted rows`. The new
history generator publishes complete rows through the actual persistence
coordinator, independently of Electric events or subset acquisition. It crosses
targeted/full reload, insertion/removal, and later partial updates. A six-cell
mode × publication-path matrix also checks public and durable rows.

Conversely, replace `hasKnownRow` with `collection._state.syncedData.has(rowId)`,
ignoring pending-presence overrides.

Killed by: `keeps $removal removal authoritative across an optimistic write and a new acquisition`
for delete and move-out. The old public row is still visible while its removal
is parked; a subsequent partial update must not resurrect it. The reset control
still passes because truncation drains immediately. The generated acquisition
histories and nine-cell reset/delete/move-out × acquisition-timing matrix remain.
These execute real acquisitions; a subset-end marker is not an acquisition.

No retained full-key index is needed. `subset acquisition avoids scanning the applied baseline with $n rows`
counts key iteration for both new and deduplicated acquisitions.

## 7. Resume capability fencing

Accept a persisted offset when `scanPersisted` exists but `whenHydrated`
does not.

Killed by: `warns once and restarts a persisted resume when hydration completion is unavailable`.
The restart control also verifies that the compatibility warning is not repeated.

## 8. Complete-row discrimination

Treat every resumed `update` as a partial row, including updates from a
`replica: 'full'` stream.

Killed by: `accepts complete replica updates from an explicit eager resume`.
The paired `rejects an unseen partial update from an explicit eager resume`
test proves that the exception does not admit partial rows.

## 9. Authoritative fresh recovery

Remove the truncate from `freshSnapshotPending` startup.

Killed by the eager cells in `electric-recovery-oracle.test.ts`: persisted
rows omitted from a fresh empty/nonempty snapshot must disappear from both
public and durable state, regardless of hydration/callback order. Normal
resume controls still retain unchanged cached rows.

## 10. Resumed tag-removal validation

Ignore unknown resumed updates instead of calling `invalidateResume()`.

Killed by `generated invalid resume transitions fail under every batch partition`, which crosses delete/move-out with eager/progressive streams and
checks retained rows, error state, and reset metadata together.

## 11. Tag ownership across collection reuse and restart

Share one tag tracker between collections, or recreate it on every sync
session instead of retaining it for a compatible same-collection resume.

Killed by `electric-descriptor-isolation.test.ts`: equal-key peer streams
cannot remove each other's rows, and compatible persisted restart must
still apply move-outs to retained tagged rows. The fresh-restart control
proves old tags do not leak into a new snapshot.

Sharing the original factory-bound utilities instead of copying them is killed
by `keeps insert acknowledgements on the owner of a reused persisted descriptor`:
an actual insert must settle from its own stream even after a peer starts.

## 12. Legal publication epochs

In `isLegalElectricPartition`, validate only the first reset in each callback.

Killed by the double-reset control in
`distinguishes callback-atomic and subset publication semantics`. The differential
property pins reset/subset/reset alongside random histories. A commit control
cannot precede a later reset within one callback, even if that callback already
started with a reset. This mutation tests the oracle's domain, not a runtime bug.

Use this focused form while iterating:

```sh
pnpm exec vitest run tests/electric-oracle.property.test.ts -t '<killing test>'
```

These mutants test the named laws. They do not claim exhaustive mutation
coverage of the package.
