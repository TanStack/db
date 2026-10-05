# Ready-callback writes during a truncate

Base revision: `931e8346f` (`main`). Grid revision: `4c338ddbd`. First
repair revision: `79c7786b4` (deferral). Split-transition revision:
`9bbeb1063`.

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

- The ready transition takes a step that runs after the status reads `ready`
  and before status listeners, ready callbacks, and the empty ready event. A
  truncate that makes the Collection ready emits its batch in that step. So
  the batch is built and enriched before any callback runs, subscribers
  receive it while the Collection is ready, and every ready effect follows it.
- An earlier revision held the batch in a publication deferral around
  `markReady`. A high-effort review found side effects of that design, listed
  below, and the maintainer chose to split the ready transition instead.
- The grid in `collection-sync-reentrancy-oracle.test.ts` derives expected
  rows from a model that overlays active intents, in order, on the source rows.
  It crosses two hooks, four prior requests, every legal callback write to keys
  1 through 4, and three subscribers. Before the truncate the source holds keys
  1 and 4. The replacement holds 1 and 2, so key 4's prefix delete must remain.
- Each grid case also checks three observations. A message that carries a
  source row is synced and remote unless a prior request owns its key. A live
  query over the Collection becomes ready showing replaced rows. A raw
  subscriber that the ready callback creates receives messages that are valid
  for the rows it saw.

## High-effort review of the deferral

| Item | Finding | Outcome |
| --- | --- | --- |
| 1 | The deferral enriched the batch at publication, so a source row could go out as local. | Fixed by the split. 48 grid cases fail with the deferral. |
| 2 | The empty ready event skipped the deferral, so a live query became ready with pre-truncate rows. | Fixed by the split. All 144 cases fail with the deferral. |
| 3 | A truncate committed inside the sync function, with a throwing `onFirstReady`, throws from `commit()` and moves the Collection to `error`. `ops.markReady()` defers the same error. | Confirmed on `main` too. Open, for a separate fix. |
| 4 | A subscriber that a ready callback creates received the whole batch. | Fixed by the split. 120 cases fail with the deferral. |
| 5 | The deferral delivered the batch and the callbacks' messages as one uncomposed batch. | Fixed by the split: they are separate publications. |
| 6 | The deferral is a truncate-only special case. Split the ready transition. | Adopted. |
| 7 | One failure-fidelity case was vacuous. | Fixed: an already-ready Collection runs no ready callbacks, so the case is removed. |
| 8 | The grid did not check virtual props, live queries, or callback subscribers. | Fixed: see the witnesses above. |
| 9 | The two guards for the deferral encoded one condition. | Gone with the deferral. |
| 10 | A cleanup inside a ready listener dropped the deferred batch. | Fixed by the split: the batch emits before listeners run. |

## Failure fidelity

CodeRabbit found that the deferral let a subscriber error escape from the
publication before the commit resolved its applied receipts. A probe showed the
same hang on `main`, through `markReady`'s empty ready event. When a truncate
made the Collection ready, a throwing subscriber or `onFirstReady` callback left
a held receipt pending forever.

The emit and the ready transition now run through one capture that keeps the
first error. The commit reports that error after its receipts settle, as it
does when the Collection is already ready. A witness holds a sync transaction
behind a persisting request, then truncates while a subscriber or a ready
callback throws. A third case throws from a subscriber on an already-ready
Collection. The two not-yet-ready cases fail on `main` and on the uncaptured
deferral.

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
  - A variant that marks the Collection ready after emitting fails 122 cases,
    because subscribers then receive the batch while the Collection is loading.
  - The publication deferral fails all 144 cases on the live-query check, 120
    on the callback-subscriber check, and 48 on the virtual-props check.
- **ORC-007: not applicable.** The grid is a fixed enumeration.
- **ORC-008: not applicable.** No stateful model changed.
- **ORC-009: met.** "Ready callback" means an `onFirstReady` callback or a
  `status:change` listener for `ready`.
- **ORC-010: met.** Each case unsubscribes, settles its requests, and cleans
  up the Collection in a `finally` block. The failure-fidelity witness checks
  that a thrown subscriber or callback error is reported after every receipt
  settles.
- **ORC-011: not applicable.** No reviewer named a fault shared by production
  and the model.
- **ORC-012: met by this record.**
- **ORC-013: met.** Each callback write appears beside its neighbors: the same
  key with and without a prior request, and a replaced key beside a
  replacement-only key and an omitted key.
- **ORC-014: not applicable.** No controlled provider or host supplies a
  premise.

## Limits

A truncate committed inside the sync function itself, whose ready callback
throws, still throws from `commit()` and moves the Collection to `error`. A
separate change will defer that error the way `ops.markReady()` does.

The grid covers one optimistic callback write per truncate. These histories
remain outside it:

- a callback that rolls back an existing request;
- a non-optimistic callback write;
- several callbacks that write;
- generated histories that combine ready callbacks with the optimistic-history
  grammar.
