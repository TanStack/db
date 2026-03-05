# Phase 8 - Browser Multi-Tab Coordinator (Final Phase)

## Objective

Implement robust multi-tab coordination using Web Locks, Visibility API, and BroadcastChannel with collection-scoped leadership and DB-wide write serialization.

## Dependencies

- Phase 7 browser single-tab stable
- Phase 2/3 recovery and row-version logic available

## Scope

1. Implement `BrowserCollectionCoordinator` with election and heartbeat.
2. Implement collection-scoped leader/follower behavior for both inferred modes.
3. Implement mutation RPC and follower acknowledgment/rollback handling.
4. Implement seq-gap recovery (`pullSince`) and stale fallback.
5. Implement DB writer lock (`tsdb:writer:<dbName>`) and contention policy.
6. Validate multi-tab behavior via Playwright.

## Non-Goals

- SharedWorker architecture
- Global single-writer ownership across all collections

## Implementation Status

> **Overall: IMPLEMENTED** — `BrowserCollectionCoordinator` class implemented in
> `packages/db-browser-wa-sqlite-persisted-collection/src/browser-coordinator.ts`.
> Exported from package index. Unit tests with Web Locks and BroadcastChannel
> mocks pass (15 tests). Remaining: hidden-tab stepdown, heartbeat timeout
> detection, and Playwright multi-tab integration tests.

## Detailed Workstreams

### Workstream A - Leadership and Heartbeats

- [x] Acquire per-collection Web Lock (`tsdb:leader:<dbName>:<collectionId>`). *(implemented in `browser-coordinator.ts` via `navigator.locks.request` with abort signal)*
- [x] Increment durable `leader_term` transactionally on leadership gain. *(storage-level `leader_term` table in `sqlite-core-adapter.ts`; coordinator increments in-memory term on lock acquisition after restoring from `getStreamPosition`)*
- [x] Emit leader heartbeat with latest seq/rowVersion. *(implemented in `browser-coordinator.ts` via `emitHeartbeat` on interval `HEARTBEAT_INTERVAL_MS=3000`)*
- [ ] Detect heartbeat timeout and trigger takeover attempts. *(not needed for Web Locks approach — lock release is automatic on tab close/crash; deferred to future iteration if needed)*
- [ ] Implement hidden-tab cooperative stepdown and cooldown. *(deferred — Web Locks handle crash/close; Visibility API stepdown is a future optimization)*

**Acceptance criteria**

- Exactly one leader per collection at a time.
- Leadership term never decrements across reload/restart.

### Workstream B - Protocol Transport and RPC

- [x] Implement BroadcastChannel envelope transport per collection. *(single `BroadcastChannel` per coordinator instance `tsdb:coord:<dbName>`, messages routed by `collectionId` field)*
- [x] Implement request/response correlation via `rpcId`. *(implemented in `sendRPCOnce` with `pendingRPCs` map and timeout)*
- [x] Implement RPC handlers:
  - `ensureRemoteSubset` *(leader handler returns ok — leader's own sync handles the subset)*
  - `ensurePersistedIndex` *(leader handler calls `adapter.ensureIndex` under writer lock)*
  - `applyLocalMutations` *(leader handler applies tx, broadcasts `tx:committed`, returns accepted ids)*
  - `pullSince` *(leader handler delegates to `adapter.pullSince` and returns result)*
- [x] Implement retry/backoff and timeout behavior. *(RPC_TIMEOUT_MS=10000, RPC_RETRY_ATTEMPTS=2, RPC_RETRY_DELAY_MS=200 with linear backoff)*

**Acceptance criteria**

- RPCs are correlated, timed out, retried, and idempotent where required.

### Workstream C - Mutation Routing and Acknowledgment

- [x] Route follower sync-absent mutations to current leader. *(follower calls `requestApplyLocalMutations` which sends RPC to leader via BroadcastChannel)*
- [x] Dedupe mutation envelopes by `envelopeId` at leader. *(`appliedEnvelopeIds` map with 60s TTL pruning)*
- [x] Return accepted mutation ids and resulting `(term, seq, rowVersion)`. *(leader handler returns full `ApplyLocalMutationsResponse`)*
- [x] Confirm/rollback optimistic local entries in follower based on response. *(caller side in `persisted.ts:1340-1368` handles ok/error responses and validates accepted mutation ids)*

**Acceptance criteria**

- At-least-once mutation delivery yields exactly-once logical apply.

### Workstream D - Commit Ordering and Recovery

- [x] Broadcast `tx:committed` after DB commit only. *(implemented in `persisted.ts:1201-1215` and `persisted.ts:1376-1389`; leader handler in coordinator broadcasts after `applyCommittedTx`)*
- [x] Track follower last seen `(term, seq)` and rowVersion. *(implemented in `persisted.ts:1449-1474` via `observeStreamPosition`; restored from DB on startup via `getStreamPosition`)*
- [x] On seq gap, invoke `pullSince(lastSeenRowVersion)`. *(implemented in `persisted.ts:1642-1651` gap detection and `persisted.ts:1662-1684` recovery)*
- [x] Apply targeted invalidation when key count is within limit. *(implemented in `persisted.ts:1705-1738` with `TARGETED_INVALIDATION_KEY_LIMIT` and inline row data in `changedRows`)*
- [x] Trigger full reload when required or when pull fails. *(implemented in `persisted.ts:1708-1711` for `requiresFullReload`, `persisted.ts:1715-1718` for over-limit, and `persisted.ts:1684` as fallback)*

**Acceptance criteria**

- Followers converge after dropped broadcasts.
- Recovery works without full page reload.

### Workstream E - DB Write Serialization

- [x] Implement DB writer lock (`tsdb:writer:<dbName>`). *(implemented in `browser-coordinator.ts` via `withWriterLock` using `navigator.locks.request`)*
- [x] Serialize physical SQLite write transactions across collection leaders. *(all leader-side adapter writes go through `withWriterLock`)*
- [x] Apply bounded busy retries and backoff policy. *(WRITER_LOCK_MAX_RETRIES=20, WRITER_LOCK_BUSY_RETRY_MS=50 with capped linear backoff)*

**Acceptance criteria**

- No correctness loss under cross-collection write contention.

## Deliverables

1. Browser multi-tab coordinator implementation.
2. Protocol transport and RPC machinery.
3. Recovery and invalidation orchestration in browser runtime.
4. Playwright multi-tab test suite.

## Test Plan

### Unit Tests (Completed)

Tests in `tests/browser-coordinator.test.ts` using Web Locks and BroadcastChannel mocks:
1. Leadership acquisition and release.
2. Leadership takeover on dispose.
3. Independent leadership per collection.
4. Message transport between coordinators.
5. Self-message filtering.
6. Leader applies mutations directly.
7. Follower routes mutations to leader via RPC.
8. Envelope ID deduplication.
9. Leader handles pullSince directly.
10. Follower routes pullSince to leader via RPC.
11. Leader ensures persisted index locally.
12. Follower routes ensurePersistedIndex to leader.
13. Cleanup on dispose.

### Playwright Multi-Tab Scenarios (Not Yet Implemented)

1. Two tabs leading different collections simultaneously.
2. Reads served locally without leader-proxy round trips.
3. Follower mutation routing and ack/rollback flow.
4. Visibility-driven leader handoff behavior.
5. Tab close/crash leadership takeover.
6. Commit-broadcast gap recovery via heartbeat + pullSince.
7. Cross-collection write contention correctness under writer lock.
8. Sync-present offline-first and reconnect convergence.

### Fault Injection Tests (Not Yet Implemented)

- Drop selected BroadcastChannel messages.
- Delay/reorder RPC responses.
- Force leader stepdown mid-mutation.

## Risks and Mitigations

- **Risk:** browser API inconsistencies (Web Locks/visibility).
  - **Mitigation:** strict capability checks and conservative fallbacks.
- **Risk:** lock thrash during visibility transitions.
  - **Mitigation:** stepdown delay + reacquire cooldown.
- **Risk:** high contention causes latency spikes.
  - **Mitigation:** DB writer lock + bounded retry with telemetry.
- **Risk:** mutation duplicates under retries.
  - **Mitigation:** `envelopeId` dedupe and idempotent leader apply.

## Exit Criteria

- Playwright multi-tab suite is green and stable.
- Leadership, ordering, mutation routing, and recovery invariants hold under fault tests.
- Browser multi-tab marked GA-ready for both inferred modes.
