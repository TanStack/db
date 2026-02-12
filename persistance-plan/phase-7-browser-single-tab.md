# Phase 7 - Browser Single-Tab (`wa-sqlite`, No Election)

## Objective

Deliver stable browser persistence for single-tab usage using `wa-sqlite` + `OPFSCoopSyncVFS`, without requiring BroadcastChannel or Web Locks.

## Dependencies

- Phase 2 wrapper behavior complete
- Phase 3 core adapter complete

## Scope

1. Implement OPFS-backed browser SQLite driver.
2. Run wrapper in single-process coordination mode.
3. Validate local-first behavior with offline/online transitions.
4. Ensure system is correct without multi-tab infrastructure.

## Non-Goals

- Web Locks leadership election
- Cross-tab mutation RPC

## Detailed Workstreams

### Workstream A - Browser Driver Implementation

- [x] Integrate `wa-sqlite` with `OPFSCoopSyncVFS`.
- [x] Build browser `SQLiteDriver` wrapper.
- [x] Handle startup/open/reopen lifecycle and capability checks.

**Acceptance criteria**

- Browser driver initializes and reopens persisted DB correctly.
- Capability errors are surfaced as `PersistenceUnavailableError` where required.

### Workstream B - Single-Tab Runtime Wiring

- [x] Use `SingleProcessCoordinator` semantics in browser single-tab mode.
- [x] Ensure no dependencies on BroadcastChannel/Web Locks.
- [x] Validate sync-present and sync-absent wrapper modes.

**Acceptance criteria**

- Single-tab mode functions fully offline-first with local writes and reads.

### Workstream C - Offline/Online Behavior

- [x] Validate offline `loadSubset` local path for sync-present mode.
- [x] Validate remote ensure replay on reconnect.
- [x] Validate sync-absent behavior unaffected by network transitions.

**Acceptance criteria**

- Correct data convergence after reconnect.

## Deliverables

1. Browser single-tab adapter/runtime package updates.
2. Capability detection and error handling behavior.
3. Browser integration tests for single-tab mode.

## Test Plan

- Browser integration suite:
  - OPFS init and reopen
  - mutation persistence correctness
  - sync-present offline + reconnect replay
  - no Web Locks/BroadcastChannel dependency

## Risks and Mitigations

- **Risk:** OPFS support differences across browsers.
  - **Mitigation:** capability matrix and clear fallback policy.
- **Risk:** WASM startup latency.
  - **Mitigation:** lazy init and connection reuse.
- **Risk:** accidental dependency on multi-tab APIs.
  - **Mitigation:** explicit tests with those APIs unavailable.

## Exit Criteria

- Browser single-tab integration tests are green.
- Offline-first behavior proven for both inferred modes.
- No election/multi-tab runtime requirements remain in this phase.
