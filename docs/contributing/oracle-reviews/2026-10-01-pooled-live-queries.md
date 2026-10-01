# Pooled live query and flat change tracking oracle review

## Reviewed state and claim

Base: `84b828c7e`, merged with `origin/main` at `18abceee4`. This record reviews
the Git tree that contains it; the final commit or pull request identifies that
tree.

The pooled live query oracle claims that a live query filtered only by
`eq(field, literal)` on one eager, non-persisted source, served from an
equality partition, publishes what its live-query Collection would: the same
rows in key order, values, and status. That holds through sync transactions,
optimistic writes confirmed or rolled back, peer mounts and unmounts, and
source cleanup and restart. The claim excludes on-demand and persisted
sources, `DbClient` hydration, Suspense, and every clause beyond `eq`
conjuncts, which keep the live-query Collection.

The flat change tracking oracle claims that, for a row whose own fields are
all primitives or functions with a plain or null prototype and no symbol
keys, the flat tracker reports the same change set as the draft proxy and an
independent model, with `0` and `-0` equal. Nested values, Dates, Maps, Sets,
class instances, and symbol keys are outside it, except that they must fall
back to the proxy.

Both oracles use `mockSyncCollectionOptions` or plain rows; neither claims a
real sync adapter's behavior.

## RED and GREEN evidence

Mutants ran through each oracle file alone on the reviewed tree. Each file was
restored after each run. Every outcome below is an assertion failure.

| Mutant | Oracle | Tests failed |
| --- | --- | --- |
| Partition ignores a row's previous group | Pooled | 6 of 9 |
| Groups keep rows in arrival order | Pooled | 2 of 9 (pinned key-order history and one campaign) |
| Literals and fields compared without `eq` normalization | Pooled | 3–4 of 9 |
| Partition skips the source's initial state | Pooled | 8 of 9 |
| View reports the source's status after cleanup | Pooled | 4 of 9 |
| Partition never terminates on cleanup | Pooled | 4 of 9 |
| Partition keys groups by the first field only | Pooled | 5 of 9 |
| Update published as delete then insert | Pooled | 3 of 9 (0 of 7 before payload checks) |
| Update carries a stale `previousValue` | Pooled | 3 of 9 (0 of 7 before) |
| Update carries the old row as its value | Pooled | 3 of 9 (0 of 7 before) |
| Within-group updates dropped | Pooled | 2 of 9 |
| Partition built on a cleaned-up source starts terminal | Pooled | 3 of 9 (0 of 7 before) |
| Frozen peers drop pending optimistic rows | Pooled | 2 of 9 (0 of 7 before) |
| Flat diff with `!==` | Flat | 3 of 17 |
| Flat diff with `Object.is` alone | Flat | 3 of 17 |
| Flat diff without deletions | Flat | 5 of 17 |
| Draft proxy without the added-field revert fix | Flat | pinned history and both campaigns |
| Flat diff ignores whether the row owns a field | Flat | 4 of 17 |
| Flat drafts edit the rows in place | Flat | 9 of 17 |
| Assigned objects not detached | Flat | 1 of 17 (detach witness) |
| Frozen rows sent to the proxy | Flat | 3 of 17 |
| Proxy ignores accessors defined in the callback | Flat | 3 of 17 |
| Proxy reports a field defined back to its own value | Flat | 4 of 17 |
| Proxy accepts a getter-only field's own value | Flat | 2 of 17 |
| Proxy reports a written hidden field's delete | Flat | 1 of 17 (pinned witness only) |
| Flat compares a hidden object field by identity | Flat | 1 of 17 (pinned witness only) |

The pooled oracle found that a pooled view followed its source's status after
cleanup instead of entering the live query's terminal error; the repair makes
the partition terminate. The flat oracle found that the draft proxy dropped a
field added as `undefined` when another field reverted, on `main` as well; the
repair treats a field the original lacks as changed. The grammar now weights
that run, so both campaigns also kill the unrepaired proxy.

The loss audit then widened both oracles. The pooled granular observer had
been checked by key membership only, so the payload and lifecycle mutants
marked "0 of 7 before" survived it. The flat grammar gained frozen rows,
non-enumerable fields, accessor and data `defineProperty`, stored drafts, and
throwing callbacks. Four shapes split the trackers, three of them on `main`'s
proxy too. The adopted rule is that defining a field acts as assigning it,
and that a non-enumerable field is row data only once the callback writes
it. The proxy now records accessors and data defines through the assignment
path, rejects a getter-only write of its own value, and ignores the delete of
a hidden field it wrote. The flat tracker now compares a hidden object field
by contents.

Local-only direct writes are compared with a local-only Collection whose
handlers resolve, across mixed multi-key batches, failing batches, schema
rejection, and every fallback for insert, update, and delete. Mutants that
ignore handler types, drop the pending or persisting check, drop the whole
transaction check, run before the ambient branch, write only the first
mutation, or never complete the transaction fail 4, 4, 4, 8, 12, 1, and 9
tests.

Two shared conformance scenarios, `eq-filter-rows` and `eq-filter-peers`, run
the pooled path under React and compiled live queries under Vue, Solid,
Svelte, and Angular. A partition that ignores a row's previous group fails
both under React and none elsewhere. `eq-filter-peers` also checks the
source's public `subscriberCount`: an adapter that declares `pooledEqFilters`
must share one subscription for two queries on the same fields. Disabling
pooling or using one partition per query fails it under React; before this
check the first passed.

The loss audit found that a partition released its source one second after
its last listener, whatever `gcTime` its views had. A focused release-timing
test, `pooled-live-query-gc.test.ts`, now compares pooled and live-query
Collection release times. A fixed delay failed 5 of 10 cases, a missing 50 ms
floor for unsubscribed queries 1, a last-`gcTime`-wins rule 1, and releasing
at `gcTime` 0 2. Release timing is resource lifetime, so the publication
oracle does not observe it.

## Pooled live query oracle

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | Pass. The `eq` operand rules come from `src/query/compiler/evaluators.ts`; the pooled boundary and the terminal-error rule come from the live-query architecture document's pooled section and cleanup law. The opening prose lists the omissions. |
| ORC-002 Independent judgment | Pass. `expectedKeys` uses a local `eq` over plain values. Order, values, and status come from a live-query Collection, which compiles a D2 pipeline and does not use the partition. |
| ORC-003 Distinguishable responsibilities | Pass. Contract, model, grammar, driver, and refinement check are separate marked sections. |
| ORC-004 Generated-history controls | Pass. Reconstruction: every pinned history uses only domain values and step kinds. Ablation, run per axis on the campaigns with pinned cases skipped: without Dates, `NaN`, and `-0` the normalization mutant survives; without optimistic steps, frozen peers dropping optimistic rows survives; without mounts and unmounts, the terminal-at-creation mutant survives; without cleanup-restart, the status, termination, and both pending-cleanup mutants survive; without the second conjunct, first-field grouping survives. Range: at most four rows, three peers, eight steps, and ids 0 through 3; field values weight toward the literal so rows update within their group. Exclusion: an optimistic update to an equal value, an insert of an existing id, and an update or delete of a missing id are dropped. |
| ORC-005 Production path and observation | Pass. `createPooledLiveQuery` and `createLiveQueryObserver`, the adapter seam, run in wholesale and granular mode; the conformance scenarios run through React's `useLiveQuery`. Rows, keyed state, status, layout revision, and non-materialization are observed after every step, and granular changes are compared with a reference observer by type, key, value, and previous value, then replayed against the model. |
| ORC-006 Checker calibration | Pass. Thirteen mutants, classified above. |
| ORC-007 Fixed/random replay | Pass. Fixed seed `44_502_001`, an unseeded campaign, and a replay entry share one property and budget; the file is in `test:oracles`. |
| ORC-008 Stateful-model minimality | Pass. The model keeps source rows and, per mounted peer, the frozen keys at cleanup. The pinned cleanup history distinguishes a frozen peer from one mounted after the restart. |
| ORC-009 Vocabulary mapping | Pass. Equality partition, partition group, and pooled live query are glossary terms; a peer is one mounted pooled live query. |
| ORC-010 Failure fidelity and cleanup | Pass. `withOracleCleanup` releases observers, references, and the source and keeps the check failure. |
| ORC-011 Independent second formulation | Pass. The live-query Collection is the second formulation for order, values, and status. |
| ORC-012 Review evidence | This record; the coverage map links it. |
| ORC-013 Reusable boundary law | Pass. Normalization is rejected by the Date history, arrival order by the key-order history, and following the source's status by the cleanup history. |
| ORC-014 Controlled-premise handoff | Not triggered. The claim is limited to the mock source's sync transactions and lifecycle. |

## Flat change tracking oracle

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | Pass. The change-set rules come from `src/proxy.ts`'s `getChanges` contract: changed fields with their final value and deleted fields as `undefined`. |
| ORC-002 Independent judgment | Pass. `expectedChanges` folds the operations over a plain copy and does not import either tracker. |
| ORC-003 Distinguishable responsibilities | Pass. Contract, model, grammar, driver, and refinement check are separate marked sections. |
| ORC-004 Generated-history controls | Pass. Reconstruction: every pinned history uses domain values and operations. Ablation: removing `NaN`, `-0`, reverts, or deletions each loses a mutant. Range: one to three rows, three fields plus one added and one non-enumerable field, frozen or not, up to six operations per row including data and accessor defines, stored drafts, and a throw. Exclusion: none in generation; non-flat rows are rejected by the fallback witness. Hidden-field deletes and hidden object fields are killed only by pinned witnesses. |
| ORC-005 Production path and observation | Pass. `withFlatChangeTracking`, `withArrayChangeTracking`, and `withChangeTracking` run the same callbacks; the result change sets are observed. `collection.update` selects between them. |
| ORC-006 Checker calibration | Pass. Thirteen mutants, classified above. |
| ORC-007 Fixed/random replay | Pass. Fixed seed `44_502_101`, an unseeded campaign, and a replay entry; the file is in `test:oracles`. |
| ORC-008 Stateful-model minimality | Not triggered. The model recomputes from the operations. |
| ORC-009 Vocabulary mapping | Pass. Draft, change set, and revert follow the proxy's terms. |
| ORC-010 Failure fidelity and cleanup | Not triggered. The oracle holds no resources. |
| ORC-011 Independent second formulation | Pass. The draft proxy is the second formulation. |
| ORC-012 Review evidence | This record; the coverage map links it. |
| ORC-013 Reusable boundary law | Pass. `!==` is rejected by the `NaN` history, `Object.is` by the `-0` history, and missing deletions by the deleted-field history. |
| ORC-014 Controlled-premise handoff | Not triggered. No provider is involved. |

## Open work

- The generated flat campaigns rarely reach a hidden object field or a
  written hidden field's delete; their pinned witnesses carry those laws.
- Pooled live queries run only in React; the other adapters keep compiled live
  queries until they use the shared resolver.
