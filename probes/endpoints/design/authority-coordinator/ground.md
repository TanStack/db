# Ground Condition: actual publication boundaries

Claim under examination: an epoch plus a quiet authoritative read can prevent older server state from replacing newer authority while DB continues to own optimistic snapshots. Ordinary baseline: one loaded collection, one action, a valid combined response, no overlapping read or lifecycle change.

## Matched observations

- **Two retained collections:** ordinary manual writes notify `[1,0]` then `[1,1]`. Holding each collection's existing `_deferPublication()` while installing both changes produces only `[2,2]` observations. These are actual Collection subscribers, not React frames. This proves the primitive can hide the installation gap; it does not yet prove safe graph propagation, retirement, listener exceptions or reentry.
- **One held ordinary read:** a fresh manual value `3` is later replaced by the held read's `0`, both in the Query cache and collection. `utils.refetch()` resolves before the queued application becomes visible. Waiting for the next task exposes the regression. Thus RPC completion and even the refetch promise are insufficient publication barriers.
- **Cleanup then rebind:** `DbClient.collection` reuses the same object. Object identity cannot identify a sync lifetime. A lifetime counter must advance at cleanup/restart, including restart through a retained handle rather than a fresh endpoint declaration.

Execution: `node probes/endpoints/design/authority-coordinator/run-ground.mjs`; receipt `ground.json`. The script bundles the actual local packages. It changes one named boundary at a time; the tiny rows are diagnostic controls, not a concurrency oracle.

## Source-backed constraints

- Query adapter result application has its own queue and cancellable sync commit (`query.ts`: `enqueueResultApplication`, `applySuccessfulResult`). Admission must survive that queue. Query cancellation alone cannot recall a result already handed to the adapter.
- DB already exposes `_deferPublication` for internal coherent publication. It defers events, not state/index installation. An outer publication context also holds downstream graph work. Both are needed to test multi-collection publication; deferring React renders would prove less.
- Core `Transaction.commit` awaits `mutationFn`, then retires one transaction. Group acknowledgement therefore needs synchronous settlement under the same publication boundary; independently resolving several mutation-function promises gives separate retirement turns.
- Core rollback preserves persisting Endpoint siblings but intentionally cascades to conflicting manually pending transactions. Preserve that documented DB behavior. The Endpoint preservation promise covers other persisting Endpoint actions, not a revision to manual DB rollback semantics.
- The server helper knows handler closure before its held inline reads complete. Only the valid handler envelope proves closure to this client. Transport rejection and local rollback do not. The previous actual-source receipt is `../stale-authority/audit/hostile-repros/source-boundaries.json`.

## Conditions and controllers

Dynamics: writes start, server handlers close, reads observe, responses arrive, authority installs, overlays retire. Constraints: single-thread synchronous publication, asynchronous adapter application, whole-row overlay ownership, no retrying opaque writes. Boundaries: current sync lifetime, exact retained set, valid versus missing handler envelope, direct versus graph observers. Runtime controls enrollment and authority admission; adapter controls query-result application; DB controls overlay retirement and notification; server controls closure evidence.

Supported range: the quiet-read argument still applies to finite traffic and valid handler outcomes on the same authoritative backend. These tests expose missing implementation boundaries, not a refutation of that argument. External writers, stale replicas and permanently unknown handlers remain outside convergence claims. Unknown handlers must remain explicit errors, not become 'closed' after a successful read.

Remaining questions for the authorized state machine and hostile check: reentrant action timing, stale already-queued applications, group retirement, and late loading lifetimes. The user's requirements remain: normal writable collections, synchronous actual Transactions, concurrent writes, all retained queries, independent PostgreSQL correctness checks. None of these observations removes those requirements.
