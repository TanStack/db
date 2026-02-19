# Phase 0 - API + Runtime Feasibility

## Objective

Lock down the API surface, protocol shape, packaging boundaries, and runtime capability assumptions before implementation begins.

## Why This Phase Exists

The later phases depend on a stable contract for:

- `persistedCollectionOptions(...)` mode inference
- coordinator protocol and required/optional methods
- runtime feature gates (browser, node, mobile, electron, DO)
- SQL key/identifier safety rules

A weak Phase 0 creates churn in every downstream package.

## Inputs

- Root design doc (`/PERSISTNCE-PLAN-SQLITE-ONLY.md`)
- Current `@tanstack/db` collection API and sync API
- Existing runtime adapter patterns in monorepo

## Scope

1. Finalize TypeScript overloads for sync-present vs sync-absent mode.
2. Finalize runtime validation rules for invalid `sync` shape.
3. Finalize coordinator protocol envelope, payload types, and idempotency keys.
4. Finalize key encoding (`s:` / `n:` with `-0` handling) and safe identifier mapping strategy.
5. Freeze package boundaries and ownership.
6. Define staged rollout gates and kill-switch/fallback strategy.
7. Freeze the v1 pushdown operator matrix for `loadSubset` (`IN`, `AND`, `OR`, `LIKE`, and date/datetime predicates).

## Out of Scope

- Implementing storage adapter logic
- Implementing browser election
- Implementing runtime-specific packages

## Detailed Workstreams

### Workstream A - API and Type Inference

- [ ] Draft final overload signatures for `persistedCollectionOptions`.
- [ ] Define `PersistedCollectionUtils` and where it appears in inferred return type.
- [ ] Document compile-time and runtime discrimination rules.
- [ ] Specify all runtime validation errors:
  - `InvalidSyncConfigError`
  - `PersistenceUnavailableError`
  - `PersistenceSchemaVersionMismatchError`

**Acceptance criteria**

- Two minimal compile tests prove inference for both modes.
- Invalid `sync` shapes are unambiguous and deterministic.

### Workstream B - Coordinator Contract and Protocol

- [ ] Freeze required coordinator methods shared by all runtimes.
- [ ] Identify browser-only optional methods (`pullSince`, mutation RPC helpers).
- [ ] Finalize message envelope versioning (`v: 1`) and forward-compat guidance.
- [ ] Define timeout/retry semantics and defaults.
- [ ] Define idempotency correlation keys and persistence requirements.

**Acceptance criteria**

- Protocol type definitions reviewed and approved.
- Browser and single-process coordinators can both satisfy the interface.

### Workstream C - Storage Safety Rules

- [ ] Finalize canonical key encoding and decode edge cases.
- [ ] Finalize collectionId -> hashed table name mapping contract.
- [ ] Confirm no SQL identifier interpolation with raw user values.
- [ ] Finalize canonical JSON date/datetime serialization contract (ISO-8601 UTC string format).

**Acceptance criteria**

- Safety invariants are codified in testable helper contracts.

### Workstream D - Packaging and Rollout

- [ ] Confirm package list and scope ownership.
- [ ] Decide what lives in sqlite core vs runtime wrappers.
- [ ] Define phase gates and success metrics.
- [ ] Define fallback behavior by runtime when persistence capability is missing.
- [ ] Freeze pushdown behavior for v1 operators, including `IN` as mandatory for incremental join loading.

**Acceptance criteria**

- Package ownership is explicit (no overlap ambiguity).
- Rollout order is accepted by maintainers.
- v1 query-planning operator commitments are explicit and testable.

## Deliverables

1. Finalized API signature document (types + runtime rules).
2. Coordinator protocol spec (envelope, payloads, retries, idempotency).
3. Capability matrix by runtime.
4. Package boundary matrix (core vs wrappers).
5. Query-planning operator matrix and date serialization contract.
6. Phase gate checklist used by later phases.

## Testing Plan

- Type-level tests for overload inference.
- Runtime validation unit tests for invalid sync config.
- Protocol shape tests (serialization and discriminated unions).

## Risks and Mitigations

- **Risk:** ambiguous mode detection with optional `sync`.
  - **Mitigation:** strict runtime guard: `sync` key present but invalid throws.
- **Risk:** coordinator contract too browser-specific.
  - **Mitigation:** optionalize browser RPC methods and validate per runtime.
- **Risk:** package boundary drift.
  - **Mitigation:** explicit ownership matrix checked in design review.

## Exit Criteria

- API and protocol types are frozen for Phases 1-3.
- Runtime capability assumptions are documented and approved.
- Package boundaries accepted by maintainers.
- No blocking unresolved decisions remain for implementation start.
