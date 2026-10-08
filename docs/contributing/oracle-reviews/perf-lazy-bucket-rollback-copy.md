# Lazy bucket rollback copy review

Evidence by revision, on `perf-lazy-bucket-snapshot` from `main` at
`2c98b4992`: the RED results ran on `main` with the new oracle. The GREEN
results, mutants and measurements ran on the branch commit that adds this
record. The layout law, the ORC-010 harness and the second mutant run were
added in a follow-up commit; "Follow-up: layout and cleanup" gives their
results.

## Contract and evidence

`BucketFacadeAdapter.flush()` writes child-facade rows through ordinary
Collection transactions and defers their events. "Coherent publication" in
`packages/db/src/query/live/ARCHITECTURE.md` requires the flush to be atomic:
if a facade write or the root commit fails, every facade returns to its rows,
order and key mapping from before the flush, and no facade publishes.

Before this change, each flush copied the stored rows of every facade, so that
a rollback could restore them. The rollback read only the copies of the
facades the flush wrote. Every successful flush paid for the other copies. A
change to one child row in a list of 50 parents with 3 rows each copied 150
rows.

The change copies a facade's rows when the flush first defers that facade's
publication. Both write paths defer before they open a sync transaction, so
the copy holds the facade's rows from before the flush. The production diff in
`bucket-facade-adapter.ts` is +19/−29.

The new owner is
`packages/db/tests/query/bucket-facade-rollback-oracle.property.test.ts`. Its
model maps each bucket to its ordered rows and keeps the operations sent since
the last successful flush. It checks two laws after every flush:

1. **Flush atomicity.** After a thrown facade commit or a rollback after
   `prepare()`, each facade shows its published rows in order, each row's key
   resolves through `getKeyFromItem`, and no facade published an event. A
   thrown flush keeps its graph output pending, and the next successful flush
   applies it.
2. **Bounded rollback work.** During a flush, the stored rows of no facade
   outside the written buckets are read.
3. **Layout.** A facade is a Collection-valued include, so an order-only
   change of a row it shows is a layout change ("Inline modes" in the
   architecture document). After a successful flush, a facade's layout
   revision advances once when a row it showed before and after the flush
   changed order and its key sequence changed, and stays put otherwise. A
   failed flush leaves the revision unchanged.

## Results

| Check | `main` | Branch |
| --- | --- | --- |
| Fixed campaign (seed 2081) | Fails: "step 1: reads of untouched b0: expected 1 to be +0" | Passes |
| Random campaign | Fails with the same counterexample | Passes |
| Pinned wide list (50 buckets × 3 rows, one insert) | Fails: 49 untouched facades read | Passes |
| Pinned retried failure (two written buckets and a retire) | Passes | Passes |

The generated histories reached 448 publishes, 188 rollbacks after `prepare()`
and 84 thrown facade commits.

Rows copied per change, measured with a counter on the copy:

| Shape | `main` | Branch |
| --- | --- | --- |
| Issue detail, 10 / 100 / 1,000 comments | 19.5 / 109.5 / 1,009.5 | 19.5 / 109.5 / 1,009.5 |
| List of 50 issues, 3 recent comments each | 150 | 3 |
| All issues, 100 × 10 comments | 1,009.5 | 19.5 |
| All issues, 1,000 × 10 comments | 10,009.5 | 19.5 |

The detail view does not improve, because its one bucket is the bucket the
flush writes. An undo log of changed keys would cover that case.

Local `scripts/bench` timings could not distinguish the change: a same-code
comparison gave 1.08× for writes, and reversing the run order moved the
branch from 1.03–1.14× to 0.83×.

## Mutants

| Mutant | Outcome |
| --- | --- |
| Copy the rows after the first write | Assertion failure: the new oracle's fixed and random campaigns, and the existing "restores facade state without public effects when a flush fails" test |
| Skip the copy for buckets created in the flush | Equivalent within the tested domain: `restore()` restores only facades that existed before the flush |
| Retire copies after its deletes | Equivalent within legal histories: the graph retracts a retired bucket's rows in the same flush, so the row phase defers and copies the facade first |
| Do not restore `currentOrder` | Assertion failure in the new oracle (fixed and random campaigns, and the pinned reorder retry) and in the existing `bucket-facade-adapter.test.ts` rollback test |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The atomicity law comes from "Coherent publication". The work law is this change's promise. The claim is limited to one ordered edge at the adapter boundary. |
| ORC-002 | Applicable. The model is a map of ordered rows and a list of pending operations. It does not import the adapter, its snapshot or its order maps. |
| ORC-003 | Applicable. The opening prose states both laws, the model, the grammar, the driver, the checkpoints and the limits. |
| ORC-004 | Applicable. The grammar covers activate, insert, update, delete and retire on buckets `b0`..`b3` and ids 1..6, with publish, thrown commit and rollback outcomes. Operations are legal against the published rows plus pending operations. The outcome counts above show each outcome was reached. |
| ORC-005 | Applicable. The driver runs the real adapter over a D2 graph and compares public facade rows, keys, events and each facade's layout revision, which the live-query observer compares to detect a reorder. The work counter wraps each facade's stored-row iterators during the flush. |
| ORC-006 | Applicable. The mutants above, with outcome classes. |
| ORC-007 | Applicable. A fixed-seed campaign and a random or replayed campaign run the same property and budget, registered as `bucket-facade.rollback-history`. |
| ORC-008 | Applicable. The model keeps published rows and pending operations. Pending operations are needed because a thrown flush keeps its graph output for the next flush. |
| ORC-009 | Applicable. "Written buckets" means buckets with a pending row operation or a retire since the last successful flush. |
| ORC-010 | Applicable. `withCleanup` keeps a history's failure as the primary error: when cleanup also throws, it throws an `AggregateError` whose `cause` is the history's failure and whose `errors` list that failure first. A calibration test forces both failures; a harness mutant that rethrows the cleanup error fails it. |
| ORC-011 | Inapplicable. No shared fault between the model and the adapter was named. |
| ORC-013 | Inapplicable. No threshold law. |
| ORC-014 | Inapplicable. No controlled provider. |

## Unresolved

- Nested facades and facade indexes are covered only by the existing tests in
  `bucket-facade-adapter.test.ts` and `includes-collection-oracle.property.test.ts`.
- The layout law observes the layout revision, not layout-only listener
  calls. A layout listener runs only for a publication without row events, and
  an order-only update publishes an update event.
- Dense single-bucket views still copy the whole written bucket.

## Follow-up: layout and cleanup

The first version of the oracle did not observe a reorder. `toArray` sorts
through the facade comparator, so the rows came back in order even when the
adapter kept stale order state after a failed flush. The stale state stops
the retried flush from marking a layout change, which the live-query observer
reads through the layout revision.

A first attempt observed layout listener calls and failed on the fixed adapter
(`step 1: layout publications of b0: expected +0 to be 1`): an order-only
update publishes an update event, and layout listeners run only for a
publication without row events. The revision is the observation the observer
uses, so the law observes it.

| Check | Result |
| --- | --- |
| Fixed adapter | 6 of 6 pass, no type errors |
| Do not restore `currentOrder` | Assertion failures in both campaigns and the pinned reorder retry. The fixed campaign also found a row-order failure after a second thrown flush: `[1, 3]` instead of `[3, 1]`. |
| Copy the rows after the first write | Assertion failures, 3 of 6 tests |
| Skip the copy for new buckets; retire copies after its deletes | Still equivalent, as above |
| Harness mutant: rethrow the cleanup error | The ORC-010 calibration fails |
