# Ready-callback writes during a truncate

Base revision: `931e8346f` (`main`). Grid revision: `4c338ddbd`. Repair
revision: `79c7786b4`.

## Law

Each change message must be valid for a consumer that has applied every
earlier message: an insert names an absent key, and an update or delete names
a present one. Authority: the change-message contract in
`packages/db/tests/change-event-history-oracle.test.ts` and issue #1901.

A truncate commit that makes the Collection ready runs ready callbacks
(`onFirstReady` and `status:change` listeners) during the commit, and a
callback may write. The truncate's messages and the callback's messages
together must be valid for every subscriber, with or without initial state and
with or without a filter. Each subscriber must end at the Collection's rows.
Subscribers receive the truncate's messages only after the Collection is ready.

## Gap and bug

State mutation round 3 found that a mutant which ran `markReady` before the
truncate reapply survived the suite. The ready-callback witness covered only an
edit of a replaced key, through a subscriber with initial state, whose sent-key
filter hides a repeated message.

The bug on `main`: the truncate built its batch from the replaced rows, then
called `markReady` before it published. A callback's messages describe the
replaced rows, but they reached subscribers before the batch that moves
subscribers to those rows. Reachable failures:

- A callback deletes a replaced key. The callback publishes the delete, and
  then the prefix deletes the key again.
- A callback deletes a key that only the replacement holds. The subscriber
  gets a delete for a row it never held.
- A callback changes a key that has an active prior request. The batch's
  re-applied insert still carries the prior value.
- A filtered subscriber holds the pre-truncate row. The callback's delete
  carries the replaced value, so the filter drops it, and the subscriber keeps
  a row that the Collection removed.

The first repair (`7331f25aa`) dropped prefix deletes for keys a callback
deleted. Code review and CodeRabbit showed the other three failures. That
repair also made the stale re-applied row silent, because the repeated delete
no longer exposed it.

## Repair and witnesses

- The commit now marks the Collection ready at the emit point, inside a
  publication deferral. Subscribers receive the truncate batch, then the
  callbacks' messages, after the Collection is ready. Every truncate event is
  built before any callback runs.
- The grid in `collection-sync-reentrancy-oracle.test.ts` derives expected
  rows from a model that overlays active intents, in order, on the source rows.
  It crosses two hooks, four prior requests, every legal callback write to keys
  1 through 4, and three subscribers. Before the truncate the source holds keys
  1 and 4. The replacement holds 1 and 2, so key 4's prefix delete must remain.

## ORC outcomes

- **ORC-001: met.** The law above names its authority and the subscriber
  modes it covers.
- **ORC-002: met.** The overlay model reads no production state. The checker
  validates each message against the subscriber's own replica.
- **ORC-003: met.** The prose above the grid states the law, the model, and
  why keys 2 and 4 are in the grid.
- **ORC-004: met.** The enumeration control checks the case count, five named
  witnesses, and two excluded illegal writes.
- **ORC-005: met.** Each case writes through a real Collection's sync and
  mutation APIs. It observes `subscribeChanges` batches, `collection.status`
  at delivery, and `collection.state`.
- **ORC-006: met.**
  - `main` and the first repair each fail 54 of 144 cases.
  - A variant that marks the Collection ready after emitting, without the
    deferral, fails 122 cases, because subscribers then receive the batch
    while the Collection is loading.
- **ORC-007: not applicable.** The grid is a fixed enumeration.
- **ORC-008: not applicable.** No stateful model changed.
- **ORC-009: met.** "Ready callback" means an `onFirstReady` callback or a
  `status:change` listener for `ready`.
- **ORC-010: met.** Each case unsubscribes, settles its requests, and cleans
  up the Collection in a `finally` block.
- **ORC-011: not applicable.** No reviewer named a fault shared by production
  and the model.
- **ORC-012: met by this record.**
- **ORC-013: met.** Each callback write appears beside its neighbors: the same
  key with and without a prior request, and a replaced key beside a
  replacement-only key and an omitted key.
- **ORC-014: not applicable.** No controlled provider or host supplies a
  premise.

## Limits

The grid covers one optimistic callback write per truncate. These histories
remain outside it:

- a callback that rolls back an existing request;
- a non-optimistic callback write;
- several callbacks that write;
- generated histories that combine ready callbacks with the optimistic-history
  grammar.
