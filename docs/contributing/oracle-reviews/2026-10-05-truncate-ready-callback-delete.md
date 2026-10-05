# A ready callback's delete during a truncate

Base revision: `931e8346f` (`main`). Pre-repair revision: `83ca40509`.
Repair revision: `7331f25aa`.

## Law

Each change message must be valid for a consumer that has applied every
earlier message: an insert names an absent key, and an update or delete names
a present one. Authority: the change-message contract in
`packages/db/tests/change-event-history-oracle.test.ts` and issue #1901.

A truncate commit marks the Collection ready before it publishes its batch. A
ready callback may write in that window. The callback's messages and the
truncate batch together must stay valid, and each subscriber must end with the
Collection's rows.

## Gap and bug

State mutation round 3 found that a mutant which ran `markReady` before the
truncate reapply survived the suite. The ready-callback witness covered only an
edit of a replaced key, through a subscriber with initial state. That
subscription filters keys it already sent, so it hides a duplicate message.

The extended witness found a bug on `main`. The truncate builds its delete
prefix from the rows visible before the replacement. A ready callback that
deletes a replaced key publishes its optimistic delete at once. The prefix
then deleted the key again, and a subscriber without initial state got a
delete for a row it no longer held.

## Repair and witnesses

- The witness in `collection-sync-reentrancy-oracle.test.ts` is now a grid of
  two hooks (`onFirstReady`, `status:change`), three callback writes (edit or
  delete a replaced key, insert a new key), and both subscriber modes. The
  starting rows include key 4, which the replacement omits, so its prefix
  delete must remain.
- The commit snapshots the optimistic deletes before `markReady`. After the
  callbacks run, it drops prefix deletes for keys that a callback deleted.

## ORC outcomes

- **ORC-001: met.** The law above names its authority. The grid covers one
  truncate commit with one callback write.
- **ORC-002: met.** Each case expects a fixed table of final rows. The checker
  validates each message against the subscriber's own replica. Neither reads
  production state.
- **ORC-003: met.** The prose above the grid states the law, the subscriber
  modes, and why key 4 is in the starting rows.
- **ORC-004: met.** The grid enumerates its 12 cases. Each callback write
  appears with both hooks and both subscriber modes.
- **ORC-005: met.** Each case writes through a real Collection's sync API and
  observes `subscribeChanges` batches and `collection.state`.
- **ORC-006: met.** On `83ca40509`, the two delete cases without initial state
  fail. The round 3 mutant that runs `markReady` before the reapply fails both
  insert cases without initial state. A wrong repair that drops every prefix
  delete for a key no longer visible fails all 12 cases.
- **ORC-007: not applicable.** The grid is a fixed enumeration, not a generated
  property.
- **ORC-008: not applicable.** No stateful model changed.
- **ORC-009: met.** "Ready callback" means an `onFirstReady` callback or a
  `status:change` listener for `ready`.
- **ORC-010: met.** Each case unsubscribes, settles its request, and cleans up
  the Collection in a `finally` block.
- **ORC-011: not applicable.** No reviewer named a shared fault.
- **ORC-012: met by this record.**
- **ORC-013: met.** The delete case has a nearby witness: key 4's prefix
  delete must remain while key 1's repeated delete is dropped.
- **ORC-014: not applicable.** No controlled provider or host supplies a
  premise.

## Limits

The grid covers one callback write per truncate. Generated histories with
ready callbacks remain outside the optimistic-history grammar.
