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

> **Overall: NOT STARTED** — No `BrowserCollectionCoordinator` class exists.
> The core coordinator interface, protocol types, and message handling skeleton
> exist in `packages/db-sqlite-persisted-collection-core/src/persisted.ts` from
> earlier phases, but no browser-specific multi-tab implementation has been written.
> The browser package (`db-browser-wa-sqlite-persisted-collection`) only uses
> `SingleProcessCoordinator`.
>
> Note: Web Locks and BroadcastChannel implementations exist in
> `packages/offline-transactions/src/coordination/` but serve a different purpose
> (transaction-level leadership, not collection-level coordination).

## Detailed Workstreams

### Workstream A - Leadership and Heartbeats

- [ ] Acquire per-collection Web Lock (`tsdb:leader:<dbName>:<collectionId>`).
- [x] Increment durable `leader_term` transactionally on leadership gain. *(storage-level `leader_term` table exists in `sqlite-core-adapter.ts:1804-1809` with MAX-based increment logic; needs browser coordinator to call it on leadership gain)*
- [ ] Emit leader heartbeat with latest seq/rowVersion. *(protocol type `LeaderHeartbeat` defined in `persisted.ts:55-61` but no emitter exists)*
- [ ] Detect heartbeat timeout and trigger takeover attempts.
- [ ] Implement hidden-tab cooperative stepdown and cooldown.

**Acceptance criteria**

- Exactly one leader per collection at a time.
- Leadership term never decrements across reload/restart.

### Workstream B - Protocol Transport and RPC

- [ ] Implement BroadcastChannel envelope transport per collection. *(protocol `ProtocolEnvelope` type defined in `persisted.ts:46-53`; no transport implemented)*
- [ ] Implement request/response correlation via `rpcId`. *(RPC types with `rpcId` fields defined; no correlation machinery implemented)*
- [ ] Implement RPC handlers:
  - `ensureRemoteSubset` *(request/response types defined; `requestEnsureRemoteSubset` in coordinator interface; no browser handler)*
  - `ensurePersistedIndex` *(in coordinator interface; `SingleProcessCoordinator` has no-op stub)*
  - `applyLocalMutations` *(request/response types defined; caller logic in `persisted.ts:1325-1365`; no browser handler)*
  - `pullSince` *(request/response types defined; caller logic in `persisted.ts:1668-1682`; no browser handler)*
- [ ] Implement retry/backoff and timeout behavior.

**Acceptance criteria**

- RPCs are correlated, timed out, retried, and idempotent where required.

### Workstream C - Mutation Routing and Acknowledgment

- [ ] Route follower sync-absent mutations to current leader. *(caller side exists in `persisted.ts:1325-1365` using `requestApplyLocalMutations`; no transport)*
- [ ] Dedupe mutation envelopes by `envelopeId` at leader. *(`envelopeId` field defined in `ApplyLocalMutationsRequest`; no dedup logic)*
- [ ] Return accepted mutation ids and resulting `(term, seq, rowVersion)`. *(response type defined; no handler)*
- [ ] Confirm/rollback optimistic local entries in follower based on response. *(partial: acceptance path in `persisted.ts:976-982`; no rollback on failure)*

**Acceptance criteria**

- At-least-once mutation delivery yields exactly-once logical apply.

### Workstream D - Commit Ordering and Recovery

- [x] Broadcast `tx:committed` after DB commit only. *(implemented in `persisted.ts:1201-1215` and `persisted.ts:1376-1389` — publishes via coordinator after `applyCommittedTx`)*
- [x] Track follower last seen `(term, seq)` and rowVersion. *(implemented in `persisted.ts:1449-1474` via `observeStreamPosition`; restored from DB on startup via `getStreamPosition`)*
- [x] On seq gap, invoke `pullSince(lastSeenRowVersion)`. *(implemented in `persisted.ts:1642-1651` gap detection and `persisted.ts:1662-1684` recovery)*
- [x] Apply targeted invalidation when key count is within limit. *(implemented in `persisted.ts:1705-1738` with `TARGETED_INVALIDATION_KEY_LIMIT` and inline row data in `changedRows`)*
- [x] Trigger full reload when required or when pull fails. *(implemented in `persisted.ts:1708-1711` for `requiresFullReload`, `persisted.ts:1715-1718` for over-limit, and `persisted.ts:1684` as fallback)*

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
