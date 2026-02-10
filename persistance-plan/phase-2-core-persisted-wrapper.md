# Phase 2 - Core Persisted Wrapper (Inferred Behavior)

## Objective

Implement `persistedCollectionOptions(...)` behavior for both runtime-inferred modes:

- sync-present: persistence augments remote sync flow
- sync-absent: persistence is local source of truth with automatic mutation persistence

## Dependencies

- Phase 0 API/protocol finalized
- Phase 1 index lifecycle events available

## Scope

1. Implement inferred mode branching with runtime validation.
2. Implement hydrate barrier and ordered tx queueing.
3. Implement sync-present remote insert normalization (`insert` -> `update`).
4. Implement sync-absent mutation persistence wrappers.
5. Implement `utils.acceptMutations(transaction)` path.
6. Wire coordinator RPC stubs and fallbacks.
7. Implement seq-gap detection and recovery orchestration.

## Non-Goals

- SQLite SQL pushdown implementation (Phase 3)
- Browser leader election internals (Phase 8)

## Detailed Workstreams

### Workstream A - Wrapper Initialization and Validation

- [ ] Implement mode selection based on presence of `sync` key.
- [ ] Throw `InvalidSyncConfigError` for invalid `sync` shapes.
- [ ] Default coordinator to `SingleProcessCoordinator` when omitted.
- [ ] Validate coordinator capabilities based on runtime mode.

**Acceptance criteria**

- Runtime behavior matches compile-time discrimination.
- Validation errors are deterministic and tested.

### Workstream B - Hydrate Barrier + Apply Queue

- [ ] Add collection-scoped hydrate state (`isHydrating`, queued tx list).
- [ ] Ensure tx events received during hydrate are queued.
- [ ] Flush queued tx in strict order after hydrate completion.
- [ ] Ensure apply mutex serializes write/apply paths.

**Acceptance criteria**

- No lost updates during hydrate.
- Ordered replay across queued tx.

### Workstream C - Sync-Present Semantics

- [ ] Wrap `sync.sync(params)` and preserve existing semantics.
- [ ] Normalize remote insert payloads to update before write.
- [ ] Trigger leader remote ensure flow through coordinator request path.
- [ ] Maintain offline-first local load behavior.

**Acceptance criteria**

- Duplicate-key conflicts do not occur on overlapping cache/snapshot data.
- Offline `loadSubset` resolves from local persistence.

### Workstream D - Sync-Absent Semantics

- [ ] Wrap `onInsert/onUpdate/onDelete` to persist first, then confirm optimistic state.
- [ ] Implement mutation envelope construction with stable `mutationId`.
- [ ] Implement follower->leader mutation RPC path (coordinator capability gated).
- [ ] Implement `acceptMutations(transaction)` utility for manual transaction support.

**Acceptance criteria**

- All mutation entry points persist consistently.
- Mutation acknowledgments map to submitted ids.

### Workstream E - Recovery and Invalidation

- [ ] Detect seq gaps from `(term, seq)` stream.
- [ ] Trigger `pullSince(lastSeenRowVersion)` when possible.
- [ ] Support fallback stale-mark + subset reload when pull fails.
- [ ] Implement targeted invalidation threshold behavior.

**Acceptance criteria**

- Gap recovery path is deterministic and tested.
- Full-reload fallback keeps state correct.

## Deliverables

1. Core persisted wrapper implementation.
2. Mode-specific mutation behavior and utilities.
3. Hydrate barrier and queueing logic.
4. Recovery orchestration implementation.

## Test Plan

### Core Unit Tests

- Inference validation and mode branching.
- Hydrate barrier queue and flush ordering.
- Sync-present insert-to-update normalization.
- Sync-absent auto-persist for insert/update/delete.
- Manual transaction persistence via `acceptMutations`.
- Seq-gap detection and pull fallback behavior.

### In-Memory Integration Tests

- Multi-node coordinator simulation for tx ordering.
- Mutation ack and rollback behavior under retries.

## Risks and Mitigations

- **Risk:** hidden race between hydrate and incoming tx.
  - **Mitigation:** collection-scoped mutex and explicit queue flushing.
- **Risk:** divergent behavior between wrapped hooks and manual transactions.
  - **Mitigation:** shared mutation envelope pipeline used by both paths.
- **Risk:** coordinator optional methods missing at runtime.
  - **Mitigation:** upfront capability validation with clear errors.

## Exit Criteria

- Both inferred modes pass in-memory suites.
- Recovery paths are validated for success and failure branches.
- Public utilities and error semantics documented.
