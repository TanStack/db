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

**Fix.** The subscription registers before the snapshot, and a publication
deferral spans the snapshot request. Work committed inside the callback still
applies at once, so reads see it, and publishes after the snapshot as one
batch. A synchronous `loadSubset` write during the request also publishes after
the snapshot; the subscription's duplicate-insert filter drops keys the
snapshot already sent.

## Why the oracles missed it

The reentrancy oracle generated listener work only from change listeners. No
history committed from inside an initial-snapshot callback.

## Witness

A snapshot lane in `collection-sync-reentrancy-oracle.test.ts` runs the same
bounded and generated histories from the snapshot callback of a subscription
created after the outer row applied, with and without a `where` clause. It has
its own seed (1775) and property name (`collection-sync.reentrant-drain-snapshot`),
so the change-listener seed keeps its histories. The model is unchanged except
for receipts: a snapshot callback runs outside the drain, so its commits apply
at once and return `true`.

| Revision | Snapshot lanes |
| --- | --- |
| `main` | 4 of 4 fail: the committed batch never arrives |
| this fix | pass |
| register early without the deferral (nested delivery) | 4 of 4 fail |

## ORC outcomes

- **ORC-001:** the oracle's stated non-reentrant publication law.
- **ORC-002:** the expected batches come from the scenario alone.
- **ORC-004:** the exhaustive bound covers every listener history for both
  snapshot sources; the generated lane samples the same grammar.
- **ORC-005:** public `subscribeChanges` and sync `begin` / `write` / `commit`.
- **ORC-006:** `main` and the nested-delivery design fail; see the table.
- **ORC-007:** fixed seed 1775 and a replayable random campaign.
- **ORC-013:** the nested-delivery mutant distinguishes the deferral from a
  bare reordering.

## Limits

- Optimistic writes inside a snapshot callback were probed but are not in the
  generated grammar.
- Two other subscription survivors from the same hunt stay open: P6 (snapshot
  keys reserved before the callback) and P1 (key tracking after a full initial
  load followed by a limited snapshot).
- Framework and adapter packages that call `subscribeChanges` were not run
  locally; CI runs them.
