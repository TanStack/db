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

## Follow-up: medium code review

Reviewed source: the commit that adds this section, on top of `3b9b74ba2`.
The review raised 10 findings. The evaluation ledger is outside the
repository; its verdicts are below.

**Laws.** The oracle now states three laws. Atomicity also requires that a
failed flush removes the facades it created. Bounded work now covers every
read path of the stored rows. The layout law is now derived from the rows a
reader sees, not from production's classifier: a revision is required when
the rows shown before and after appear in a different relative order,
forbidden when the shown key sequence is identical, and allowed otherwise.

| Finding | Verdict | Change |
| --- | --- | --- |
| 1. Work counter did not see `forEach` | Confirmed | The counter also wraps `forEach`, `get` and `has`. |
| 2. Layout model copied the production classifier | Confirmed | Three-part layout law above. |
| 3. Nested-facade rollback was claimed covered but was not | Confirmed | Pinned case: the child edge commits, the parent edge throws. The child facade is restored, the parent keeps its reference to it, and the child facade created by the flush is removed. |
| 4. Missing failure cuts | Confirmed | The grammar adds a throw from a facade's first write (open sync transaction) and a throw from the commit of a facade the flush creates. The nested case covers a second edge after the first commits. A retire on a non-empty facade cannot occur in legal histories (see mutants). |
| 5. `check()` skipped buckets the model lacks | Confirmed | `check()` compares the adapter's facade set with the model's buckets. |
| 6. A rollback after `prepare()` ended the history | Confirmed | The history continues after a rollback; a pinned case sends a rolled-back reorder again. |
| 7. `?? []` could restore a facade to empty | Confirmed | `restore()` iterates the copied rows, so a missing copy cannot occur. |
| 8. `deferredEntries` duplicated the copied rows' keys | Confirmed | Removed. |
| 9. Copy-before-write was a convention | Confirmed | One `write()` helper copies, defers, begins and commits for both write paths. |
| 10. `snapshot()` still copies the edge and bucket maps | Confirmed, scoped | Not changed. A lazy copy would need a copy-on-write hook across the window from `flush()` to `publish()`/`rollback()`, including `resolve()` calls after `flush()` returns. The changeset now says the bucket bookkeeping still grows with the number of buckets. |

**Mutants** (ORC-006), run against this oracle and against the previous one:

| Mutant | This oracle | Previous oracle |
| --- | --- | --- |
| Eager copy through `forEach` | Assertion failure | Survived |
| Layout revision without a key change | Assertion failure | Assertion failure |
| No layout revision when membership also changes | Assertion failure | Assertion failure |
| Layout from common-row relative order only | Survives: the contract allows it | Assertion failure: the old model over-specified |
| Entries map not restored | Assertion failure | Assertion failure |
| Stale order state after a rollback | Assertion failure | Survived |
| Rows copied after the first write | Assertion failure | Assertion failure |
| Retired facade copied after its deletes | Equivalent: a retired bucket's rows retract in the same flush, so retire finds an empty facade | Equivalent |

**Production delta:** `bucket-facade-adapter.ts` is now +41/−54 against
`main`, net −13.

**Unresolved:** the random campaign rarely sends a rolled-back reorder again;
the pinned case covers it. The edge and bucket map copy is not measured.

## Follow-up: child rows lost after a failed root commit

Found while evaluating the medium review, and confirmed on `main`
(`f6d65eace`) and on this branch before the fix.

**Law.** After a failed root commit, the next successful flush publishes every
change that was pending at the failed flush, child rows included, exactly once.
The live-query builder keeps its pending root changes when the root commit
fails. Before this fix, the facade adapter had already cleared its pending
child rows and activations, so `rollback()` restored the facades but lost
their pending changes.

**Witness.** A live query with a Collection-valued include. One write updates
the parent and the child, and the root commit throws. A retry writes only a
further parent change. On `main` and on the unfixed branch, the parent shows
the retry while the child keeps `value: 1` and publishes no event, although the
source holds `value: 2`. With the fix, the child shows `value: 2` and publishes
one event.

**Oracle.** The rollback outcome now keeps the model's operations pending, as
a thrown flush does. RED before the fix: both campaigns failed with "facades
held by the adapter: expected [] to deeply equal [ 'b0' ]" (a lost
activation), and a pinned case failed with "rows of b0: expected [ { id: 1, v:
1 } ] to deeply equal [ { id: 1, v: 2 } ]". The includes owner gained the
public witness above.

**Fix.** `flush()` keeps the pending rows and activations it consumed;
`rollback()` puts them back. No graph output arrives between a flush and its
rollback, so the maps are empty when it does.

**Mutant.** Dropping the pending rows on rollback fails both campaigns, the
pinned case, and the includes witness (assertion failures).

**Not covered by the law.** When no further write reaches the live query after
a failed root commit, no flush runs, so the root and the child both keep their
rows from before the failure until the next write. Whether a failed commit
should schedule its own retry is a design question; this change does not add
one.

## Recorded limits (maintainer decision, 2026-10-08)

**Bucket bookkeeping copy (finding 10).** `snapshot()` still copies each edge's
`entries` map and `activeBuckets` set on every flush. The maintainer accepted
this as a documented limit. Measured per comment write, with a scratch variant
that skips the copy (an upper bound, because that variant cannot roll back):

| Unlimited include | Entries copied | Copy share of a write |
| --- | ---: | ---: |
| 10 parents | 20 | about 2% |
| 100 parents | 200 | about 6% |
| 1,000 parents | 2,000 | about 31% |
| 10,000 parents | 20,000 | about 83% |

A limited query ("list + 3 recent comments", limit 50) copies no entries,
because only the parents in its window hold facades. A lazy copy for each edge
does not help, because one edge holds all the buckets. The follow-up, if large
unlimited include queries matter, is a per-bucket undo log (about +20/−15
lines plus oracle cases for activate, retire and restore of a new entry). Raw
data: `~/.cw-perf/bucket-f10/RESULTS.md` (local).

**Retry after a failed root commit.** The maintainer recorded this as a design
question for later. A retry needs a public contract, a backoff and a stop
condition before it can earn its code weight.

## Follow-up: second medium code review (2026-10-08)

Reviewed head `bf6caffb1`. The review had nine findings. The evidence for each one is below.

| Finding | Verdict | Change |
| --- | --- | --- |
| 1. Successful flushes do not check events | Confirmed | Law 1 now checks events on each successful flush. The subscriber starts from the facade's current rows (`includeInitialState`). Its events name only rows that a pending operation touched, at most once each. A replay of the events on the previous rows gives the shown rows. |
| 2. `ARCHITECTURE.md` says the adapter buffers no deltas | Confirmed | The adapter paragraph and "Coherent publication" state the retention law and the rollback invariant. |
| 3. `rollback()` can overwrite new pending deltas | Confirmed as an unchecked invariant | `rollback()` throws (code 230) when graph output arrived after the flush. The flush runs inside the graph run, so this cannot occur in a legal history. A pinned witness covers it. |
| 4. Per-flush bookkeeping copy | Accepted design | The maintainer decision is recorded below. |
| 5. Per-flush `write` closure | Confirmed | Removed. The copy, the deferral and the write are at the one write site. |
| 6. The retire write branch is unreachable | Confirmed | The branch is removed. A retire that finds rows throws (code 231). A probe that threw on that branch ran the full `@tanstack/db` suite (11,267 tests) and reached it zero times. A pinned witness covers the throw. |
| 7. Pending maps are copied, then cleared | Confirmed | The flush swaps the map references, and the rollback swaps them back. |
| 8. The oracle reads adapter internals | Confirmed, documented | The Limits section gives the reason: `resolve` creates facades, so the facade set and the new-facade failure need the private map and factory. Rows, events and layout revisions are public Collection state. |
| 9. The "only way to write a facade" comment is wrong | Confirmed | The comment now says this is the only place where a flush applies graph deltas. |

An earlier draft of the event law subscribed without initial state. It reported missing delete events after a thrown flush. That was a wrong observation, not a product bug. A subscriber without initial state does not receive events for rows that it was never sent, and it receives an insert for an update to such a row. The same history gives the same events on `main`.

Mutants, against the extended oracle (with the includes oracle and the adapter tests) and against the oracle at `bf6caffb1`:

| Mutant | Extended oracle | Previous oracle |
| --- | --- | --- |
| Apply the consumed deltas again after publish | Assertion failure (20 tests) | Assertion failure (4 tests), through the work law |
| Drop the events of a delete-only facade write | Assertion failure at the successful flush (step 1) | Assertion failure only at a later rollback |
| Rollback restores over new pending deltas | Assertion failure (witness) | Survives |
| Retire deletes rows and does not throw | Assertion failure (witness) | Survives |
| Copy rows after the first write | Assertion failure (12 tests) | Assertion failure (7 tests) |
| Apply each change twice | Equivalent: the repeated identical update publishes no event | Equivalent |

Production: `bucket-facade-adapter.ts` is +54/−64 against `main` (net −10).
