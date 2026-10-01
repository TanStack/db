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
| Partition ignores a row's previous group | Pooled | 6 of 7 |
| Groups keep rows in arrival order | Pooled | 2 of 7 (pinned key-order history and one campaign) |
| Literals and fields compared without `eq` normalization | Pooled | 3 of 7 |
| Partition skips the source's initial state | Pooled | 6 of 7 |
| View reports the source's status after cleanup | Pooled | 3 of 7 |
| Partition never terminates on cleanup | Pooled | 3 of 7 |
| Flat diff with `!==` | Flat | 3 of 8 |
| Flat diff with `Object.is` alone | Flat | 3 of 8 |
| Flat diff without deletions | Flat | 3 of 8 |
| Draft proxy without the added-field revert fix | Flat | 1 of 8 (pinned history only) |

The pooled oracle found that a pooled view followed its source's status after
cleanup instead of entering the live query's terminal error; the repair makes
the partition terminate. The flat oracle found that the draft proxy dropped a
field added as `undefined` when another field reverted, on `main` as well; the
repair treats a field the original lacks as changed. The generated flat
campaigns did not reach that history; only its pinned case kills the
unrepaired proxy.

Two shared conformance scenarios, `eq-filter-rows` and `eq-filter-peers`, run
the pooled path under React and compiled live queries under Vue, Solid,
Svelte, and Angular. A partition that ignores a row's previous group fails
both under React and none elsewhere.

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
| ORC-004 Generated-history controls | Pass. Reconstruction: every pinned history uses only domain values and step kinds. Ablation: removing Dates, `NaN`, or `-0` loses the normalization mutant; removing optimistic steps loses rollback; removing mount and unmount loses remounted groups; removing cleanup-restart loses the terminal-error mutants; removing the second conjunct loses multi-field groups. Range: at most four rows, three peers, eight steps, and ids 0 through 5. Exclusion: an optimistic update to an equal value, an insert of an existing id, and an update or delete of a missing id are dropped. |
| ORC-005 Production path and observation | Pass. `createPooledLiveQuery` and `createLiveQueryObserver`, the adapter seam, run in wholesale and granular mode; the conformance scenarios run through React's `useLiveQuery`. Rows, keyed state, status, layout revision, and non-materialization are observed after every step. |
| ORC-006 Checker calibration | Pass. Six mutants, classified above. |
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
| ORC-004 Generated-history controls | Pass. Reconstruction: every pinned history uses domain values and operations. Ablation: removing `NaN`, `-0`, reverts, or deletions each loses a mutant. Range: one to three rows, three fields plus one added field, five operations per row. Exclusion: non-flat rows are rejected by the fallback witness. |
| ORC-005 Production path and observation | Pass. `withFlatChangeTracking`, `withArrayChangeTracking`, and `withChangeTracking` run the same callbacks; the result change sets are observed. `collection.update` selects between them. |
| ORC-006 Checker calibration | Pass. Four mutants, classified above. |
| ORC-007 Fixed/random replay | Pass. Fixed seed `44_502_101`, an unseeded campaign, and a replay entry; the file is in `test:oracles`. |
| ORC-008 Stateful-model minimality | Not triggered. The model recomputes from the operations. |
| ORC-009 Vocabulary mapping | Pass. Draft, change set, and revert follow the proxy's terms. |
| ORC-010 Failure fidelity and cleanup | Not triggered. The oracle holds no resources. |
| ORC-011 Independent second formulation | Pass. The draft proxy is the second formulation. |
| ORC-012 Review evidence | This record; the coverage map links it. |
| ORC-013 Reusable boundary law | Pass. `!==` is rejected by the `NaN` history, `Object.is` by the `-0` history, and missing deletions by the deleted-field history. |
| ORC-014 Controlled-premise handoff | Not triggered. No provider is involved. |

## Open work

- The generated flat campaigns do not reach the added-field revert history;
  only its pinned case covers it.
- Pooled live queries run only in React; the other adapters keep compiled live
  queries until they use the shared resolver.
