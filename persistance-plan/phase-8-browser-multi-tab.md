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

## Detailed Workstreams

### Workstream A - Leadership and Heartbeats

- [ ] Acquire per-collection Web Lock (`tsdb:leader:<dbName>:<collectionId>`).
- [ ] Increment durable `leader_term` transactionally on leadership gain.
- [ ] Emit leader heartbeat with latest seq/rowVersion.
- [ ] Detect heartbeat timeout and trigger takeover attempts.
- [ ] Implement hidden-tab cooperative stepdown and cooldown.

**Acceptance criteria**

- Exactly one leader per collection at a time.
- Leadership term never decrements across reload/restart.

### Workstream B - Protocol Transport and RPC

- [ ] Implement BroadcastChannel envelope transport per collection.
- [ ] Implement request/response correlation via `rpcId`.
- [ ] Implement RPC handlers:
  - `ensureRemoteSubset`
  - `ensurePersistedIndex`
  - `applyLocalMutations`
  - `pullSince`
- [ ] Implement retry/backoff and timeout behavior.

**Acceptance criteria**

- RPCs are correlated, timed out, retried, and idempotent where required.

### Workstream C - Mutation Routing and Acknowledgment

- [ ] Route follower sync-absent mutations to current leader.
- [ ] Dedupe mutation envelopes by `envelopeId` at leader.
- [ ] Return accepted mutation ids and resulting `(term, seq, rowVersion)`.
- [ ] Confirm/rollback optimistic local entries in follower based on response.

**Acceptance criteria**

- At-least-once mutation delivery yields exactly-once logical apply.

### Workstream D - Commit Ordering and Recovery

- [ ] Broadcast `tx:committed` after DB commit only.
- [ ] Track follower last seen `(term, seq)` and rowVersion.
- [ ] On seq gap, invoke `pullSince(lastSeenRowVersion)`.
- [ ] Apply targeted invalidation when key count is within limit.
- [ ] Trigger full reload when required or when pull fails.

**Acceptance criteria**

- Followers converge after dropped broadcasts.
- Recovery works without full page reload.

### Workstream E - DB Write Serialization

- [ ] Implement DB writer lock (`tsdb:writer:<dbName>`).
- [ ] Serialize physical SQLite write transactions across collection leaders.
- [ ] Apply bounded busy retries and backoff policy.

**Acceptance criteria**

- No correctness loss under cross-collection write contention.

## Deliverables

1. Browser multi-tab coordinator implementation.
2. Protocol transport and RPC machinery.
3. Recovery and invalidation orchestration in browser runtime.
4. Playwright multi-tab test suite.

## Test Plan

### Playwright Multi-Tab Scenarios

1. Two tabs leading different collections simultaneously.
2. Reads served locally without leader-proxy round trips.
3. Follower mutation routing and ack/rollback flow.
4. Visibility-driven leader handoff behavior.
5. Tab close/crash leadership takeover.
6. Commit-broadcast gap recovery via heartbeat + pullSince.
7. Cross-collection write contention correctness under writer lock.
8. Sync-present offline-first and reconnect convergence.

### Fault Injection Tests

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
