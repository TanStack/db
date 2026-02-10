# Phase 6 - Cloudflare Durable Objects

## Objective

Implement Durable Object-native SQLite persistence using in-process execution (no browser election path), while preserving wrapper semantics for both inferred modes.

## Dependencies

- Phase 2 wrapper behavior complete
- Phase 3 core adapter complete

## Scope

1. Build DO SQLite adapter package for code executing inside the DO instance.
2. Provide schema initialization and version check helper utilities.
3. Support sync-present and sync-absent wrapper modes in DO runtime.
4. Validate behavior with Workers/DO integration harness.

## Non-Goals

- Browser lock/election protocols
- Remote DB proxy adapter pattern

## Detailed Workstreams

### Workstream A - DO Adapter Binding

- [ ] Map DO SQL storage APIs to `SQLiteDriver` contract.
- [ ] Ensure transaction semantics align with core adapter expectations.
- [ ] Provide helper for collection table mapping initialization.

**Acceptance criteria**

- Core adapter runs with no DO-specific branching beyond driver wrapper.

### Workstream B - Runtime Semantics

- [ ] Default coordinator to `SingleProcessCoordinator`.
- [ ] Confirm no browser RPC/election method requirements.
- [ ] Ensure sync-absent mode behaves as first-class local persistence path.

**Acceptance criteria**

- DO runtime operates correctly without multi-tab coordination logic.

### Workstream C - Schema and Recovery

- [ ] Implement startup schema version checks per object instance.
- [ ] Support clear-on-mismatch for sync-present mode.
- [ ] Support throw-on-mismatch default for sync-absent mode.
- [ ] Validate restart and rehydrate paths.

**Acceptance criteria**

- Schema policy matches global design contract.
- Object restarts recover state cleanly.

## Deliverables

1. `@tanstack/db-cloudflare-do-sqlite-persisted-collection`
2. DO initialization helpers and usage docs
3. DO integration test suite

## Test Plan

- Workers/DO integration tests for:
  - schema init and mismatch behavior
  - local-first `loadSubset`
  - sync-absent mutation persistence
  - restart durability
  - no-election path correctness

## Risks and Mitigations

- **Risk:** subtle API mismatch in DO SQL wrapper.
  - **Mitigation:** adapter conformance tests at driver boundary.
- **Risk:** incorrect assumptions about single-threaded execution.
  - **Mitigation:** explicit `SingleProcessCoordinator` semantics and tests.
- **Risk:** schema resets during active request bursts.
  - **Mitigation:** transactional reset flow and deterministic error handling.

## Exit Criteria

- DO package passes integration suite.
- Both inferred modes work in DO runtime.
- Runtime docs clarify in-process model and limitations.
