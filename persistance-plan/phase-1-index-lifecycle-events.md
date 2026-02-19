# Phase 1 - Add Index Lifecycle Events to `@tanstack/db`

## Objective

Expose index lifecycle events in `@tanstack/db` so persistence can mirror index create/remove behavior consistently across tabs and runtimes.

## Dependencies

- Phase 0 protocol and signature finalization complete.
- Agreement on stable index signature strategy.

## Scope

1. Emit `index:added` and `index:removed` events.
2. Add index removal API (`removeIndex(...)`) to collection/index manager.
3. Ensure emitted payloads contain stable, serializable metadata.

## Non-Goals

- Building persisted SQLite indexes (Phase 3+)
- Browser tab synchronization behavior

## Detailed Workstreams

### Workstream A - Event Surface Design

- [ ] Define event payload types for `index:added` and `index:removed`.
- [ ] Ensure payload includes fields needed to generate stable signature.
- [ ] Add versioning guidance if payload schema evolves.

**Acceptance criteria**

- Event payloads can be serialized and replayed.
- Payload includes enough data to build deterministic signature hash.

### Workstream B - Index Manager Integration

- [ ] Update `CollectionIndexesManager` to emit `index:added` after successful registration.
- [ ] Implement `removeIndex(...)` and emit `index:removed` on successful removal.
- [ ] Ensure idempotent behavior for duplicate remove calls.

**Acceptance criteria**

- Add/remove events fire exactly once per state transition.
- Removing unknown index is deterministic (documented behavior).

### Workstream C - Backward Compatibility

- [ ] Verify existing index consumers are not broken by new API.
- [ ] Add compatibility notes in changelog/docs.
- [ ] Confirm no behavior changes to query semantics.

**Acceptance criteria**

- Existing tests pass without relying on new events.
- New APIs are additive and non-breaking.

## Deliverables

1. Event types and public API changes in `@tanstack/db`.
2. `removeIndex(...)` implementation with tests.
3. Updated docs/examples for index lifecycle events.

## Test Plan

### Unit Tests

- `createIndex` emits `index:added` with stable metadata.
- `removeIndex` emits `index:removed`.
- Duplicate remove handling is deterministic.

### Integration Tests

- Event ordering under rapid create/remove sequences.
- Auto-index interaction with lifecycle events.

## Risks and Mitigations

- **Risk:** unstable index metadata across tabs/processes.
  - **Mitigation:** enforce canonical serialization before emitting.
- **Risk:** event emission before internal state update.
  - **Mitigation:** emit only after successful state transition.

## Exit Criteria

- Lifecycle events are available and documented.
- `removeIndex(...)` is production-ready.
- Test coverage confirms stable metadata and event ordering.
