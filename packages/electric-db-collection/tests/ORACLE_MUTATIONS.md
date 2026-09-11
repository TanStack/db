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

## 12. SDK reset framing

In `isSdkResetFramedPartition`, allow resets to share a callback with data, or
validate only the first reset. Killed by
`keeps SDK reset callbacks separate from every neighboring message kind`:
seven message kinds cross both sides of the reset, with split controls.
The previous predicate rejected only commit-before-reset; it incorrectly
accepted data-before-reset and reset-before-data in the protocol model.

`electric-sdk-framing.test.ts` independently uses the real SDK with controlled
HTTP responses. Both normal and stale-row-bearing 409 bodies produce singleton
reset callbacks, as the generated protocol histories now require. This pins the
installed SDK's HTTP reset path, not an exhaustive specification of every possible
server response or SSE path.

The synthetic partition property remains as extra adapter robustness coverage;
it deliberately tests more callback shapes than the SDK-framed differential
properties. Those shapes are not evidence of a reachable protocol regression.

## 13. Progressive snapshot transaction ownership

Pass `transactionStarted` instead of `true` when applying a buffered move-out
during the initial progressive atomic swap. That normal-stream flag is false,
but the swap has already called `begin()`. Opening another transaction strands
the first truncate. Later presence checks then reject valid live updates.

Killed by `preserves live updates after ... initial tagged move-outs` and
`generated initial tagged move-outs preserve later live updates`. The matrix
crosses all three modes with zero, one and repeated matching move-outs, then
delivers a new insert and a partial update after the initial up-to-date. Every
contiguous callback partition is tested. Expected rows follow tag membership
and ordinary row updates, without consulting adapter transaction state.

The bug was RED in two progressive fixed cases and the random property (seed
`-1632249566`, path `0:1`); seven fixed controls passed. Previous tag tests began
after readiness, while the initial-sync generators lacked tag move-outs followed
by later live work. This was also reproduced by the full service-backed Electric
E2E suite, not only a synthetic callback driver.

Use this focused form while iterating:

```sh
pnpm exec vitest run tests/electric-oracle.property.test.ts -t '<killing test>'
```

## 14. Owner, durable membership, and callback boundaries

The descriptor-isolation histories now derive descriptors from original options,
once-spread options, and an existing collection's `config`. They vary startup,
peer edits, and which peer is retired. Each owner's public rows and cleanup
counts must remain independent. Nesting an already-bound sync fails this law:
the original owner stays ready but stops receiving updates. The binding guard
keeps ownership with the outermost wrapper while preserving source delegation;
removing that guard makes the generated law fail again.

The persisted-tag histories compare row/tag sets against real adapter execution
across warm restart and cold recreation, each with resume and fresh-snapshot
controls. Generated updates either preserve tags or replace membership; generated
move-outs remove membership until rows disappear. The durable fixture copies
values and applies row and collection metadata mutations, rather than preserving
in-memory object references. Cold resume failed because cached values and an
offset survived, but membership did not. Later untagged updates matter because
their last-message headers cannot reconstruct earlier tag membership.

The chosen recovery contract refetches a full snapshot when a cold start lacks
required membership, including older unknown metadata. The generator crosses
tagged/untagged histories, legacy/current metadata, all three sync modes, and
interruption during replacement. It checks cached rows before the final commit,
omitted rows afterward, subsequent move-outs, and public/durable agreement.
Lazy modes make an actual subset acquisition to hydrate cached rows. Existing
untagged resume fixtures explicitly declare that they do not need tag state;
the legacy cells retain coverage for missing metadata. A subset-end during cold
recovery must not publish the incomplete replacement.

The callback-reentry histories retire a session either before a stale callback
or inside an `awaitMatch` predicate at a generated row position. Only the
replacement stream may acknowledge new-session waiters. Generated message tails
must not cross that boundary. The law also registers a replacement waiter inside
the restart callback: the old match iteration must not visit it. Epoch guards
after user callbacks fence both the waiter loop and the remaining message batch.

All three extensions have fixed-seed and random properties, with the shared
oracle multiplier and seed/path replay controls. These are ordinary assertions,
not expected-failure classifiers. At `049cc9a5d`, fixed seeds `42711`, `42712`,
and `42713` reproduce the three failures respectively. Binding and reentry use
epoch/ownership guards; persisted membership uses the approved refetch contract.

The separate mixed `[insert, must-refetch, up-to-date]` report exposed the
protocol-model gap corrected in section 12. It remains outside the verified
generated domain. A production fix would still need evidence of a conforming
server/SDK path that delivers that mixed callback.

These mutants test the named laws. They do not claim exhaustive mutation
coverage of the package.
