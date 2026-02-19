# Phase 5 - React Native + Expo

## Objective

Provide a unified mobile SQLite persistence package for both React Native and Expo using `op-sqlite`, with minimal platform divergence.

## Dependencies

- Phase 3 core adapter stable.
- Phase 2 wrapper semantics stable.

## Scope

1. Build shared mobile adapter package over `op-sqlite`.
2. Add RN/Expo-specific entrypoints only where host initialization differs.
3. Validate lifecycle, transaction, and persistence semantics on both hosts.

## Non-Goals

- Cross-process mobile coordination
- Browser multi-tab semantics

## Detailed Workstreams

### Workstream A - Shared Mobile Driver Layer

- [ ] Implement `SQLiteDriver` wrapper around `op-sqlite`.
- [ ] Ensure consistent transaction boundaries and error mapping.
- [ ] Validate serialization/parsing paths for JSON payloads.

**Acceptance criteria**

- Same core adapter code runs unchanged on RN and Expo.
- Driver behavior matches node contract expectations.

### Workstream B - Runtime Entrypoints

- [ ] Provide RN entrypoint for bare/native setup.
- [ ] Provide Expo entrypoint for managed workflow setup.
- [ ] Keep API parity with node/browser wrappers where possible.

**Acceptance criteria**

- Consumers can swap runtimes with minimal app-level code change.

### Workstream C - Mobile Lifecycle Hardening

- [ ] Validate foreground/background transitions.
- [ ] Validate reopen behavior after app process restart.
- [ ] Confirm no data loss under rapid mutation bursts.

**Acceptance criteria**

- Persistence survives app restarts.
- Transaction semantics hold under lifecycle transitions.

## Deliverables

1. `@tanstack/db-react-native-sqlite-persisted-collection`
2. RN and Expo entrypoint docs/examples
3. Mobile-focused integration tests

## Test Plan

- Shared adapter contract suite where harness supports mobile runtime.
- RN integration tests:
  - loadSubset startup path
  - mutation persistence
  - restart durability
- Expo integration tests with equivalent scenarios.

## Risks and Mitigations

- **Risk:** runtime differences between RN and Expo initialization.
  - **Mitigation:** isolate host bootstrapping in thin entrypoint layer.
- **Risk:** mobile backgrounding interrupts in-flight writes.
  - **Mitigation:** short transactions and robust retry/rollback handling.
- **Risk:** driver behavior divergence from node.
  - **Mitigation:** enforce shared contract tests against both runtimes.

## Exit Criteria

- Unified mobile package works on RN and Expo.
- Contract and lifecycle tests pass in both environments.
- Documentation clearly explains host-specific setup steps.
