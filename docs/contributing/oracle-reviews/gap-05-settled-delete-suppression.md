# Queued same-key sync and settled-delete suppression

Reviewed production head: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
Reviewed executable oracle head: `e2517f15d96252e0382a3ba79cc832c5332b4bb8b`.
Source finding: GAP-05 in the local code-weight audit, lines 497-511.

## Contract and witness

The optimistic-history model owns the public row and change-message law. A
failed optimistic insert leaves no row. A committed sync transaction that is
still queued has not yet published its row. Thus the failed insert must publish
its delete before that sync transaction can publish an insert.

The fixed history in `optimistic-history-publication.test.ts` starts empty.
It starts a nonoptimistic insert for key 1 and an optimistic insert for key 2.
Both mutation handlers remain pending. A normal sync transaction then writes
key 2 and commits, but key 1 keeps it queued. Key 2 rejects while key 1 still
persists. Finally key 1 succeeds, allowing the queued sync transaction to
apply. The oracle compares the Collection, its change-message replica, and a
downstream live-query Collection after each action. It also checks the exact
native event trace: insert local key 2, delete local key 2, then insert remote
key 2. A missing-delete observation fault fails at the failed-settlement cut.

The history has two distinct settlement checkpoints. At the first, key 1 still
persists, `shouldBatchEvents` is false, and key 2's delete is public. At the
second, the sync transaction applies and its insert becomes public. The test
does not claim a batch between these checkpoints or a successful same-key
acknowledgment for the failed insert.

## Reachability of the proposed filter

The filter under review is the second filter in
`CollectionStateManager.recomputeOptimisticState`, near line 786 of the
reviewed head. It can suppress a delete only when all these facts hold:

1. `shouldBatchEvents` is true and the recompute is not user-triggered.
2. The event key belongs to a pending sync operation.
3. The event survived the earlier `recentlySyncedKeys` filter.
4. No active transaction has a mutation for that key.

For the direct mutation-settlement and queued-sync call graph at this head,
the first three facts cannot coexist. Only `onTransactionStateChange` sets
`shouldBatchEvents` true. It immediately calls `capturePreSyncVisibleState`,
which adds every pending sync-operation key to `recentlySyncedKeys`, and then
calls `recomputeOptimisticState` without an await or callback between capture
and recompute. The earlier filter removes every non-user-triggered event with
one of those keys. A persisting sibling instead keeps `shouldBatchEvents`
false, as the witness demonstrates. Cancellation can remove pending keys; it
does not add an uncaptured surviving key. A normal sync commit with no
persisting transaction drains its queue synchronously.

This is a bounded unreachability argument for current legal Collection calls,
not a proof about future entry points or arbitrary mutation of private state.
It leaves production deletion for a separate code-weight PR.

## Verification and limits

- Baseline publication owner: 12/12 passed.
- With the new fixed history: 13/13 passed. Its missing-delete observation
  fault failed at the failed-settlement publication check.
- With a temporary throw at the second filter's delete-candidate branch, the
  fixed history still passed. The branch was unreached.
- With the entire second filter temporarily removed, 13/13 publication tests
  passed. Classify this mutant as surviving within this tested domain, not as
  an assertion kill. Both temporary production edits were reverted.

The fixed history pins one same-key schedule and exact public change events.
The existing generated optimistic-history grammar owns adjacent values,
settlements, and source batches. Neither this test nor mutant survival proves
equivalence under arbitrary future reentry or a changed recompute call graph.
The coverage map assigns that remaining reach question to this owner before
STATE-07/STATE-15 changes production.

The exact `eventTrace` assertion requires an own `metadata` property whose
value is `undefined`. `ChangeMessage.metadata` is optional, so omitting that
property is allowed by the public type. A temporary trace-only normalization
that omitted only undefined metadata left the production callback and the
shared driver's checks intact, but failed the strict trace assertion. This is
a test-shape limit, not evidence of a wrong public publication. `$origin` and
`$synced` remain useful assertions: they are documented public virtual row
properties, not internal markers.

The shared history driver appends to `eventTrace` for every noninitial callback
on every `runOptimisticHistory` invocation. Only this fixed history asserts
the returned trace. The extra work and storage grow with callback count; no
product effect or work threshold was measured. Any later harness cleanup must
retain the ordered insert/delete/insert observation and the missing-delete
fault's failed-settlement checkpoint.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The established optimistic-history contract supplies row and event truth; the fixed schedule is the limit. |
| ORC-002 | The whole-row base/intent/source-queue model does not import the recompute filters. |
| ORC-003 | The existing owner keeps contract, model, grammar, real Collection driver, and per-step refinement visible. |
| ORC-004 | Not triggered: this change adds a fixed history, not a generated-history claim. |
| ORC-005 | `createCollection`, `subscribeChanges`, sync `commit`, and mutation settlement run; the event trace is checked after every recorded step. |
| ORC-006 | The missing-delete observation fault fails at the intended settlement cut. The production filter-removal mutant survives and is reported separately. |
| ORC-007 | Not triggered: the new case is fixed; the existing generated owner keeps its campaigns and replay. |
| ORC-008 | No reference-model state changes. The reachability argument above applies its distinguishing-history method to the production filter. |
| ORC-009 | No new model-only concept or renamed production concept. |
| ORC-010 | The shared driver retains its `withHistoryCleanup` failure and resource handling. |
| ORC-011 | No distinct shared semantic fault or second formulation was found; the oracle already checks reads, events, and a downstream query at each step. |
| ORC-012 | This record preserves the evaluated head, evidence, limits, and remaining owner. |

## Review disposition

The audit correctly identified a coverage gap and a useful same-key history.
Its suggested filter-removal mutant cannot be killed by the proposed history
under the current call graph. The public-history test is retained; the filter
stays in production until the separate code-weight review decides whether to
remove it. No product bug was reproduced. All three GAP-05 source items are
accounted for: history added, mutant classified as surviving, and STATE-07/
STATE-15 deferred to the named code-weight follow-up.
