# Phase 4 - Node + Electron

## Objective

Ship production-ready Node and Electron adapters on top of the shared SQLite core, ensuring behavioral parity and clear process boundaries.

## Dependencies

- Phase 3 adapter contract green in Node harness.
- Phase 2 wrapper semantics stable.

## Scope

1. Node package over `better-sqlite3` using shared `SQLiteDriver` adapter.
2. Electron package with main-process ownership and renderer IPC bridge.
3. Parity validation between Node and Electron behavior.

## Non-Goals

- Browser coordination or OPFS concerns
- Mobile runtime adaptation

## Detailed Workstreams

### Workstream A - Node Package

- [ ] Implement `better-sqlite3` driver adapter with Promise-based interface.
- [ ] Expose `persistedCollectionOptions` wiring for node usage.
- [ ] Validate transaction and error semantics in sync + async wrappers.

**Acceptance criteria**

- Node package passes all shared adapter contract tests.
- API ergonomics match core expectations.

### Workstream B - Electron Architecture

- [ ] Define IPC API surface (renderer requests -> main execution).
- [ ] Keep SQLite and persistence execution in main process only.
- [ ] Implement request/response timeout and structured error transport.
- [ ] Ensure renderer cannot bypass main-process ownership.

**Acceptance criteria**

- Renderer operations function through IPC with no direct DB access.
- Error and timeout behavior are deterministic.

### Workstream C - Parity and Reliability

- [ ] Reuse Node adapter logic in Electron main process.
- [ ] Run shared contract suite against electron harness where supported.
- [ ] Add smoke tests for app lifecycle (start/restart/close).

**Acceptance criteria**

- Node and Electron behavior are equivalent for core flows.
- No Electron-specific correctness regressions.

## Deliverables

1. `@tanstack/db-node-sqlite-persisted-collection`
2. `@tanstack/db-electron-sqlite-persisted-collection`
3. Electron IPC bridge docs and example integration

## Test Plan

- Full adapter contract suite on Node.
- Electron integration tests:
  - read/write round-trip through IPC
  - process restart and persistence durability
  - error propagation and timeout handling
- Regression tests for schema mismatch and reset flows.

## Risks and Mitigations

- **Risk:** IPC latency impacts hot-path operations.
  - **Mitigation:** batch operations where possible and keep payloads compact.
- **Risk:** Electron renderer attempts direct file/db access.
  - **Mitigation:** hard architecture rule: DB in main process only.
- **Risk:** subtle sync-vs-async wrapper mismatch.
  - **Mitigation:** strict parity tests and adapter abstraction boundaries.

## Exit Criteria

- Node and Electron packages published with parity tests green.
- IPC boundary validated for correctness and reliability.
- Documentation includes integration guidance for app teams.
