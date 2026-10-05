# Optimistic state drops at settlement

Pre-repair executable revision: `origin/main` at `95c3f9ec9`.
Repair branch: `fix-settled-snapshot-ack`. Production code `b5e498ddb`
through `9b82ac3dc`. Evidence head `3c85ac0de`.

## Law

An optimistic transaction overlays its optimistic state only while its
mutation function runs. When the mutation function settles, fulfilled or
rejected, the state drops. Success does not wait for a sync confirmation: a
handler that returns before its server row arrives shows the previous synced
row until that row applies.

A sync transaction committed while an optimistic transaction persists is
*accepted* and held. It becomes *visible* in the publication that drops the
optimistic state, and `isPersisted` settles after that publication.

Each sync transaction therefore has two moments:

- **Accepted:** `commit()` returns, or a persistence wrapper finishes its
  durable step. Handler-facing writes wait for this moment: Query Collection
  direct writes, persisted mutation confirmation and startup, and the PowerSync
  mutation path.
- **Visible:** the rows apply and publish. Commit receipts, subset loads, and
  Collection readiness wait for this moment.

An accepted transaction always applies, in commit order, and a later abort
cannot withdraw its rows. A load whose caller aborted still rejects with
`AbortError`. A source discards a stale page by checking the signal before
`commit()`.

A sync write is `$origin: 'local'` only if it was committed while the
transaction persisted. A write committed after settlement is `'remote'`.

Authority: user decisions recorded in the PR discussion for this branch. These
replace the accepted-snapshot retention law (#1213, #1807, #1822, #1870) and
`begin({ immediate })` (#1130).

## Gap

Since #1213, `recomputeOptimisticState` retained a completed direct
transaction's row until a later sync transaction wrote its key. Query
Collection direct writes used `begin({ immediate: true })` to apply during
persistence. After such a write, no later sync transaction retired the
retained row. Passing runs of `awaits persisted server responses in update
handlers` depended on an unrelated persisted sync transaction arriving later.

The optimistic-history oracle encoded the retention law as its reference
model, so the oracle agreed with the drift.

In #1990, a refetch canceled an earlier result's commit that was waiting for
storage. The cancellation invalidated the dependent result, and the collection
entered `error`.

## Repair and witnesses

- **Core:** removes `begin({ immediate })`, post-commit cancellation, retention
  and its dependency machinery, the truncate optimistic snapshot, and the
  direct-transaction marker. The only hold left keeps a completed row while a
  queued sync transaction touches its key.
- **Receipts:** a commit receipt resolves at visibility. It carries its
  acceptance moment (`withAcceptedReceipt` / `whenSyncAccepted`). Readiness
  waits for accepted rows to publish.
- **Query Collection:** direct writes read and validate accepted rows, and
  update the Query cache after acceptance. That cache read was the root cause
  of #1130. A refetch commits without a signal and no longer rolls back
  accepted ownership. An eager fetch that started before a direct write is
  discarded.
- **Persistence:** stores a held source transaction at acceptance. Internal
  applies inside the apply mutex wait only for acceptance. Electric reserves
  its commit turn through `persistence.reserveCommitTurn()`.
- **Electric and TrailBase:** reject an aborted load after its accepted rows
  apply.
- **Optimistic-history oracle:** the prose, model, grammar, and driver are
  rewritten. The handler writes at every cut, with and without awaiting
  acceptance. It observes the rows visible when `isPersisted` settles, allows a
  single cut at settlement, keeps receipts pending while queued, and checks
  `$origin` for held and later confirmations.

| Run | Result |
| --- | --- |
| #1990 refetch, first durable write held, on `origin/main` | 3 of 3 isolated runs fail: `expected 'error' to be 'ready'` |
| #1990 handler `writeUpsert`, result write held, on `origin/main` | 4 of 5 full-file runs fail: `expected +0 to be 3` (the retained optimistic row) |
| Real-SQLite handler test ported from #2002, on `origin/main` (`await source.commit()`) | times out after 5000 ms |
| Same three on the branch | pass; Query Collection file passes 5 of 5 full-file runs |
| `awaits persisted server responses in update handlers`, branch | 20 of 20 full-file runs pass |
| Eager refetch older than a handler `writeUpsert`, before its fix | `expected 2 to be 3` |

## Mutants

Each mutant is a temporary production edit that is restored after its run.

| Mutant | Owner | Result |
| --- | --- | --- |
| Retention kept: hold a completed row without a queued sync transaction | state-retention oracle | killed |
| Held sync applies before the drop (immediate bypass) | state-retention oracle | killed, 11 failures |
| `isPersisted` resolves before publication | state-retention oracle | killed, 40 failures |
| Handler-facing receipt waits for visibility | state-retention oracle | killed, 6 failures |
| Load settles at acceptance | load-subset oracle and state retention | killed, 10 and 4 failures |
| `$origin` marker persists until the next write | state-retention oracle | killed, 6 failures |
| Held confirmation marked `'remote'` | state-retention oracle | killed, 7 failures |
| Core abort cancels an accepted transaction | load-subset and refinement oracles | killed |
| Stale eager fetch applies | Query Collection | killed |
| Query cache reads applied rows | Query Collection | killed |
| TrailBase aborted load resolves | TrailBase | killed |
| Electric aborted load resolves | Electric | killed |
| Query Collection passes its signal to `commit()` again | Query Collection | survived; equivalent |
| Query Collection rolls back accepted ownership on supersession | ownership oracle | survived at first, then killed |

Survivors:

- **Signal passed to `commit()`:** this mutant is equivalent. Core now ignores
  a post-commit abort, so the signal cannot cancel an accepted transaction. The
  core-level mutant above covers this law.
- **Ownership rollback:** every supersession test held durable storage. In that
  case the result's core transaction had already applied, so restoring the old
  ownership did nothing. The ownership oracle now also holds the result behind
  a persisting mutation and checks visible and synced rows after each refetch,
  including a later empty refetch. The mutant fails there.

### After the merge with the state-stack refactor

Every mutant above, plus five more, ran again on the merged code. The merge
took #2004's smaller state stack and kept this branch's laws.

| Mutant | Owner | Result |
| --- | --- | --- |
| Retention kept | state-retention oracle | killed, 5 failures |
| Held sync applies before the drop | state-retention oracle | killed, 12 failures |
| `isPersisted` resolves before publication | state-retention oracle | killed, 44 failures |
| Handler-facing receipt waits for visibility | state-retention oracle | killed, 5 failures |
| Load settles at acceptance | load-subset oracle and state retention | killed, 11 and 4 failures |
| `$origin` marker persists until the next write | state-retention oracle | killed, 11 failures |
| Held confirmation marked `'remote'` | state-retention oracle | killed, 9 failures |
| An open sync transaction counts for holds | state-retention oracle | killed, 5 failures |
| Older held row wins over the newest completed row | state-retention oracle | killed, 1 failure |
| Pre-sync capture counts an open transaction | state-retention oracle | killed, 1 failure |
| Replay invalidates a committed transaction instead of throwing | state-retention oracle | killed, 1 failure |
| DbClient chunk queues after open transactions | DbClient hydration oracle | killed, 2 failures |
| Core abort listener drops an accepted transaction | load-subset and refinement oracles | killed, 1 and 1 failures |
| Core abort listener calls the cancel path | load-subset and refinement oracles | survived; see below |
| Stale eager fetch applies | Query Collection | killed |
| Query cache reads applied rows | Query Collection | killed |
| Query Collection passes its signal to `commit()` again | Query Collection | killed, 1 failure |
| Query Collection rolls back accepted ownership on supersession | ownership oracle | killed |
| TrailBase aborted load resolves | TrailBase | killed, 5 failures |
| Electric aborted load resolves | Electric | killed, 1 failure |

Corrections and survivors:

- **Signal passed to `commit()`:** the earlier run selected no test, because
  its name filter no longer matched the supersession test. With the correct
  filter, the mutant fails. It is not equivalent, and the earlier note about
  it is withdrawn.
- **Core abort calls the cancel path:** `cancelPendingSyncedTransaction` now
  throws `SyncQueueInvariantError` for a committed transaction. The guard
  stops the cancellation before it changes state, so the accepted rows still
  apply. The unguarded variant, which removes the accepted transaction
  directly, fails in both oracles.

## Limits

- **On-demand self-load:** a handler that awaits an on-demand load of its own
  Collection waits for itself. This history is documented and outside the
  generated grammar.
- **Truncate:** a truncate still applies while a transaction persists, and the
  still-persisting transactions overlay it.
- **`duplicate subset loads correctly`:** 0 of 10 full-file runs fail on
  `origin/main`. On the branch it failed every time because its handler wrote
  no confirmation, until the fixture was changed.
- **Eager refetch race:** the guard covers eager mode. On-demand mode keeps its
  post-write authority path.

## Verification

At `3c85ac0de` with built `dist`:

- **db:** 7920 tests, and 8224 with type checking; no type errors.
- **Query Collection:** 945 tests with type checking; no type errors.
- **Other packages:** Electric 629, persistence core 374, node SQLite 110,
  PowerSync 176, offline 242, TrailBase 67, RxDB 12. React, Vue, Solid, Svelte,
  and Angular pass.
- **Checks:** `test:oracles`, `check:mangle`, and `test-minified-db` pass.
