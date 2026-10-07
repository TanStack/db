# Writes from inside a snapshot callback

Base revision: `9e8ed9978` (`main`). Found while classifying a surviving
subscription mutant (P6) during the code-weight recombination trip.

## Law

The sync reentrancy oracle states it: a publication is not reentrant. Work a
listener commits while a batch publishes queues behind that batch and
publishes once, as the next batch. A subscription's initial-snapshot delivery
is a publication to that subscriber, so the same law applies to work its
callback commits.

## The failure

```ts
collection.subscribeChanges(
  () => {
    sync.begin()
    sync.write({ type: `update`, value: { id: 1, v: 10 } })
    sync.commit() // returns true; the collection now holds v: 10
  },
  { includeInitialState: true },
)
// main: the subscriber received only the snapshot (v: 1) and never the update
```

The subscriber's replica stayed at `v: 1` while the Collection held `v: 10`. A
later unrelated write did not repair it. The same happened with a `where`
clause.

**Cause.** `CollectionChangesManager.subscribeChanges` added the subscription
to `changeSubscriptions` only after `requestSnapshot` returned, and
`requestSnapshot` runs the callback. A commit inside the callback published to
every registered subscriber except this one.

**Fix.** A subscription with initial state registers before its snapshot, and
`CollectionSubscription.requestInitialSnapshot` gates its own events during
setup:

- Before the snapshot is read, it drops events. The snapshot it is about to
  read already reflects them, so the initial state still arrives as one batch.
- While the snapshot callback runs, it holds each published batch. When the
  snapshot request returns, it delivers those batches in order, through its
  normal filter. Each commit is its own batch, as every other subscriber saw
  it, so no batch holds two changes for one key.
- A Collection cleanup during setup discards the batches held so far, as
  cleanup discards every unpublished publication. Batches after a restart in
  the same callback still arrive.
- A setup that throws delivers none of them.

Work committed inside the callback still applies at once, so reads see it.
Other subscribers are untouched: they receive each commit as it lands.

## A rejected first design

The first revision held a Collection-wide publication deferral across the
snapshot request. A medium code review found that it changed behavior for
every subscriber: a synchronous `markReady` during `loadSubset` reached
subscribers before the row data; a listener error from the deferred publish
could replace the setup error; rows a synchronous load wrote reached the new
subscriber again as updates; a nested `discard()` could drop every publication
in the window; and existing subscribers received late, flattened batches. The
review also found that the filtered lane's `where` clause rejected no row. The
subscription-local gate replaces the deferral, and the oracle now rejects the
deferral design.

## Second review

A medium review of the first gate found more problems, all fixed here:

- A cleanup counter discarded commits from a sync run restarted later in the
  same callback. The subscription's own cleanup hook now clears the held
  batches, so later batches still arrive.
- The held events merged into one batch, which could hold several changes for
  one key, and `push(...changes)` could exceed the argument limit. Each batch
  is now held as it was published.
- An empty ready batch during the callback was dropped. Held batches keep
  empty ones.
- The setup protocol was split across two classes. `requestInitialSnapshot`
  now owns it.

Accepted with limits below: a throw from the new subscriber's own callback on
a held batch fails its setup, as a throw from the snapshot callback does on
`main`; subscription `status:change` events are not held; and a subscription
created inside a snapshot callback now follows the outer one in delivery
order. The review also asked whether the subscription lifecycle grammar oracle
should own this. Its subscription ownership and replay contract does not
change; the new law is a publication reentrancy law, which this oracle owns.

## Why the oracles missed it

The reentrancy oracle generated listener work only from change listeners. No
history committed from inside an initial-snapshot callback.

## Witness

A snapshot lane in `collection-sync-reentrancy-oracle.test.ts` runs the same
bounded and generated histories from the snapshot callback of a subscription
created after the outer row applied. A filtered variant's `where` clause
rejects keys from 4 on, and the model drops them from that subscriber's
batches. An observer subscribed earlier must receive each commit at once, as
its own batch. The lane has its own seed (1775) and property name
(`collection-sync.reentrant-drain-snapshot`), so the change-listener seed keeps
its histories. A snapshot callback runs outside the drain, so its commits apply
at once and return `true`.

Pinned witnesses cover setup paths the grammar does not generate:

- A synchronous `loadSubset` write during the snapshot request does not reach
  the new subscriber again, and its initial state arrives as one batch.
- A cleanup inside the snapshot callback discards the held batch. After a
  restart in the same callback, reconciliation deletes the cleared row and the
  new row arrives.
- A snapshot callback that commits and then throws fails `subscribeChanges`,
  and the subscriber receives nothing more.
- Two commits to one key inside the callback arrive as two batches.

| Revision | Snapshot lanes | Pinned witnesses |
| --- | --- | --- |
| `main` | 4 of 4 fail: the committed batches never arrive | restart and same-key fail |
| Collection-wide deferral (first design) | 4 of 4 fail: the observer's batches are late and flattened | load fails: `update 1` repeated |
| first gate (one merged batch, cleanup counter) | 4 of 4 fail | restart and same-key fail |
| this fix | pass | pass |
| cleanup keeps held batches | pass | both cleanup cases fail |
| gate drops held batches | 4 of 4 fail | restart fails |
| gate delivers pre-snapshot events live | pass | load fails: two initial batches |
| a failed setup delivers held batches | pass | throw fails |

## ORC outcomes

- **ORC-001:** the oracle's stated non-reentrant publication law.
- **ORC-002:** the expected batches come from the scenario alone.
- **ORC-004:** the exhaustive bound covers every listener history for both
  snapshot sources; the generated lane samples the same grammar.
- **ORC-005:** public `subscribeChanges` and sync `begin` / `write` / `commit`.
- **ORC-006:** `main` and the nested-delivery design fail; see the table.
- **ORC-007:** fixed seed 1775 and a replayable random campaign.
- **ORC-013:** the table's designs each fail a distinct check: the deferral
  fails the observer and load checks, and each gate mutant fails its own.

## Limits

- Optimistic writes inside a snapshot callback were probed but are not in the
  generated grammar.
- Subscription `status:change` events are not held, so a status listener can
  see `ready` before held rows arrive. On `main` those rows never arrive.
- A subscription created inside another's snapshot callback now follows it in
  delivery order. No contract fixes the order between subscribers.
- Two other subscription survivors from the same hunt stay open: P6 (snapshot
  keys reserved before the callback) and P1 (key tracking after a full initial
  load followed by a limited snapshot).
- Framework and adapter packages that call `subscribeChanges` were not run
  locally; CI runs them.
