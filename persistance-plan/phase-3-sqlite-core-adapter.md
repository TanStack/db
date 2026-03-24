# Phase 3 - SQLite Core Adapter

## Objective

Deliver the runtime-agnostic SQLite adapter core that powers persisted collection reads/writes, index management, row-version catch-up, and schema policy handling.

## Dependencies

- Phase 2 wrapper behavior complete
- Stable index lifecycle metadata from Phase 1

## Scope

1. Implement adapter operations: `loadSubset`, `applyCommittedTx`, `ensureIndex`.
2. Implement metadata schema initialization and evolution checks.
3. Implement partial update merge semantics.
4. Implement idempotency via `applied_tx`.
5. Implement row-version catch-up inputs and tombstone behavior.
6. Implement schema mismatch policies per mode.
7. Implement metadata pruning policies.

## Non-Goals

- Runtime-specific driver bindings beyond SQLiteDriver interface
- Browser/Web Locks behavior

## Detailed Workstreams

### Workstream A - DDL and Initialization

- [ ] Create collection table and tombstone table mapping.
- [ ] Create metadata tables:
  - `collection_registry`
  - `persisted_index_registry`
  - `applied_tx`
  - `collection_version`
  - `leader_term`
  - `schema_version`
  - `collection_reset_epoch`
- [ ] Add deterministic bootstrap order and migrationless checks.

**Acceptance criteria**

- Adapter can initialize clean DB from empty state.
- Re-initialization is idempotent.

### Workstream B - Key and Identifier Safety

- [ ] Implement `encodeStorageKey` / `decodeStorageKey` helpers.
- [ ] Handle `-0`, finite number checks, and string/number identity.
- [ ] Implement safe `collectionId` -> physical table name registry mapping.

**Acceptance criteria**

- No collisions between numeric and string keys.
- No unsafe identifier interpolation paths remain.

### Workstream C - Transaction Apply Pipeline

- [ ] Implement DB writer transaction logic for committed tx apply.
- [ ] Increment/read `collection_version.latest_row_version` per tx.
- [ ] Upsert rows and clear tombstones on upsert.
- [ ] Upsert tombstones on delete.
- [ ] Insert idempotency marker in `applied_tx`.

**Acceptance criteria**

- Replaying `(term, seq)` does not duplicate mutations.
- Row version is monotonic and shared across tx mutations.

### Workstream D - Query Planning and Pushdown

- [ ] Implement supported predicate pushdown (`eq`, `in`, `gt/gte/lt/lte`, `like`, `AND`, `OR`).
- [ ] Treat `IN` as required v1 functionality for incremental join loading paths.
- [ ] Handle `IN` edge cases (`[]`, single item, large lists with parameter batching).
- [ ] Implement date/datetime predicate compilation for JSON string fields.
  - prefer canonical ISO-8601 UTC string comparisons when possible
  - compile to `datetime(...)` / `strftime(...)` when normalization is required
- [ ] Implement `orderBy` alignment with index expressions.
- [ ] Implement fallback to superset + in-memory filter for unsupported fragments.

**Acceptance criteria**

- Query results match query-engine semantics.
- Incremental join loading paths using `IN` are fully pushdown-capable in v1.
- Unsupported expressions still return correct result after filtering.

### Workstream E - Index Management

- [ ] Compile persisted index spec to canonical SQL expression text.
- [ ] Implement `ensureIndex` with stable signature tracking.
- [ ] Track index state and usage timestamps in registry.
- [ ] Implement optional removal/mark-removed behavior.

**Acceptance criteria**

- Same logical index spec yields same signature and SQL.
- Repeated ensure calls are idempotent.

### Workstream F - Schema Policy and Cleanup

- [ ] Implement schema version checks per collection.
- [ ] Sync-present mismatch path: coordinated clear + reset epoch.
- [ ] Sync-absent mismatch path: throw (unless opt-in reset).
- [ ] Implement `applied_tx` pruning by seq/time policy.

**Acceptance criteria**

- Schema mismatch behavior follows design contract by mode.
- Pruning does not break pull/catch-up correctness.

## Deliverables

1. Shared SQLite core adapter implementation.
2. DDL bootstrap and metadata policy implementation.
3. Query pushdown + fallback logic.
4. Index registry and signature management.

## Test Plan

### Contract Test Matrix (Node runtime first)

- `applyCommittedTx` correctness and idempotency.
- `loadSubset` correctness with/without index pushdown.
- Pushdown parity tests for `AND`/`OR`, `IN` (empty/single/large), `LIKE`, and date/datetime filters.
- Tombstone catch-up and key-level delta behavior.
- Schema version mismatch mode behavior.
- Key encoding round-trips and collision safety.
- Identifier safety for hostile collection ids.
- Pruning behavior and recovery correctness.

## Risks and Mitigations

- **Risk:** pushdown mismatch with query engine semantics.
  - **Mitigation:** equivalence tests with randomized predicates.
- **Risk:** SQL busy/contention in concurrent runtimes.
  - **Mitigation:** writer lock integration in upper coordinator layers plus retries.
- **Risk:** schema clear races with active reads.
  - **Mitigation:** reset epoch and explicit collection reset handling.

## Exit Criteria

- Node-based adapter contract suite is green.
- Metadata/state invariants are validated under replay and recovery.
- Adapter is ready for runtime wrapper integration (Phases 4-8).
