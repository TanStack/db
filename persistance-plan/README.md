# Persistence Plan - Phase Breakdown

This folder contains the detailed execution plan for the SQLite-only persisted collection architecture.

## Phase Files

1. [Phase 0 - API + Runtime Feasibility](./phase-0-api-runtime-feasibility.md)
2. [Phase 1 - Index Lifecycle Events in `@tanstack/db`](./phase-1-index-lifecycle-events.md)
3. [Phase 2 - Core Persisted Wrapper](./phase-2-core-persisted-wrapper.md)
4. [Phase 3 - SQLite Core Adapter](./phase-3-sqlite-core-adapter.md)
5. [Phase 4 - Node + Electron](./phase-4-node-electron.md)
6. [Phase 5 - React Native + Expo](./phase-5-react-native-expo.md)
7. [Phase 6 - Cloudflare Durable Objects](./phase-6-cloudflare-durable-objects.md)
8. [Phase 7 - Browser Single-Tab (OPFS)](./phase-7-browser-single-tab.md)
9. [Phase 8 - Browser Multi-Tab Coordinator](./phase-8-browser-multi-tab.md)

## Delivery Principles

- SQLite-only persistence architecture across all runtimes.
- Collection-scoped leadership with DB-level write serialization.
- Local-first `loadSubset` behavior in both sync-present and sync-absent modes.
- One shared contract test suite across adapters.
- Browser multi-tab is intentionally the final rollout gate.

## Suggested Milestone Gates

- **Gate A (Core Semantics):** Phases 0-2 complete.
- **Gate B (Storage Correctness):** Phase 3 complete with contract tests green.
- **Gate C (Runtime Parity):** Phases 4-6 complete.
- **Gate D (Browser Readiness):** Phases 7-8 complete with integration tests.

## Agent Guard Rails

Use these rules when implementing any phase:

1. No work is complete without tests in the same change.
2. Do not advance phases unless current-phase exit criteria and CI are green.
3. For query operators (`IN`, `AND`, `OR`, `LIKE`, date/datetime), always test:
   - SQL pushdown path
   - fallback filtering path
4. `IN` is mandatory for v1 incremental join loading:
   - cover empty/single/large lists and SQLite parameter chunking
5. Date/datetime predicates require:
   - canonical ISO-8601 UTC serialization
   - timezone/offset boundary tests
   - coverage for both lexical compare and SQLite date-function normalization paths
6. Any leadership/replay/mutation routing change must include failure-path tests.
7. Shared semantics must pass cross-runtime contract tests.
8. Schema mismatch and corruption behavior must be explicitly tested by mode.
