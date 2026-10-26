# One insert per key after a truncate

Pre-repair executable revision: `da4e6b7cd` (oracle extension on `201220b51`).
Repair executable revisions: `67b5f73a1`, then `64da25f00`.

## Law

Each change message must be valid for a consumer that has applied every
earlier message: an insert names an absent key, and an update or delete names
a present one. Authority: the change-message contract in
`packages/db/tests/change-event-history-oracle.test.ts` and issue #1901. A
truncate batch is no exception. After its delete prefix, it must insert each
visible key at most once.

## Gap

A truncate commit re-applies the optimistic upserts and publishes each one as
an insert. The reapply loop in `state.ts` meant to replace the server's insert
for the same key. It ran before the changed-key loop that pushes that insert,
so its search never matched. When a key was both re-applied and changed by
the commit, the batch inserted it two times.

The optimistic-history oracle missed it because its only subscriber used
`includeInitialState: true`. That subscription filters keys it already sent,
so the second insert never reached the replica. The change-event oracle has a
strict mirror but uses a local-only Collection, which never truncates.

CodeRabbit found it on PR #2004. The state-stack mutation round 2 had already
listed the redundant insert push as reached in 72 cases on `main`, but no
observation showed it there.

## Repair and witnesses

- The optimistic-history driver adds a raw subscriber that starts from the
  visible rows. Its batches pass the same event-semantics check as the main
  subscriber, and its replica must equal the model at each checkpoint.
- The changed-key loop skips keys that the truncate already published.
- `collection-sync-reentrancy.test.ts` pinned the duplicate in its trace
  `[1, 2, 3, 1, 3, 1, 2]`. The trace is now `[1, 2, 3, 1, 3, 2]`.

## Follow-up from review: `64da25f00`

**Ready callback during a truncate.** A truncate marks the Collection ready
before its changed-key loop runs. A ready callback that edits a replaced key
adds an optimistic upsert that the batch has not published. The first repair
read the live upsert map, so it skipped that key's insert, and the subscriber
lost the row. The loop now skips only the keys that the reapply loop
published, frozen before `markReady`. CodeRabbit found this on #2005. The
optimistic-history grammar has no ready callbacks, so it could not reach this
history. A witness in `collection-sync-reentrancy.test.ts` covers
`onFirstReady` and `status:change` callbacks. It fails on `67b5f73a1` and
passes on `main` and `64da25f00`.

**Accepted delete under an active insert.** A random campaign of the extended
oracle found a second invalid insert on `main`, with no truncate. A completed
direct delete retires on the next sync commit. When an active optimistic
insert covered the key, retirement added the key to the changed keys without
the row that subscribers last saw, so the commit inserted it again. Upsert
retirement already recorded that row. Both loops now share one helper. A
pinned replay in `optimistic-history-publication-oracle.test.ts` fails on `main` for
an immediate commit. A non-immediate commit waits for the active insert, so
it passes on both.

## ORC outcomes

- ORC-002 independent judgment: the replica check uses the model's visible rows
  and the protocol rule, not production event code.
- ORC-006 checker calibration: on `da4e6b7cd` the extended oracle fails 7 cases
  in the retention oracle, the settlement replays, and both random campaigns.
  A wrong repair that skips every changed key during a truncate fails 2 cases.
- ORC-007 fixed and random campaigns: the fixed and random campaigns pass on
  `64da25f00`, including three runs at 20 times the usual count. The
  `@tanstack/db` suite passes 236 files and 8,178 tests.

## Limits

The raw subscriber has no `where` clause and no ordering. Filtered and limited
raw subscriptions through a truncate remain with the WHERE predicate
publication owner, which lists truncate as outside its scope.
