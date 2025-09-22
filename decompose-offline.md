# Offline Transactions Refactor Plan

## Goals
- Make the offline executor lifecycle explicit and testable (per-transaction state machine).
- Break apart large classes (`OfflineExecutor`, `TransactionExecutor`, `OfflineTransaction`) into composable utilities with targeted unit tests.
- Improve resilience around retries, leadership changes, and optimistic/UI synchronization.
- Preserve public API while providing a path to incremental adoption.

## Current Pain Points
- **Hidden lifecycle**: `OfflineTransaction`/`TransactionExecutor` coordinate through side effects and promise maps, making races (like the recent waiter bug) easy to reintroduce.
- **Monolithic classes**: `TransactionExecutor` handles scheduling, persistence, retry delays, and signaling in one file. `OfflineExecutor` owns storage, leadership, connectivity, and promise coordination.
- **Sparse tests**: Existing Vitest suite exercises only instantiation. No coverage for retries, multi-tab leadership, or optimistic updates.
- **Example-coupled validation**: React demo is the only integration test and requires manual verification.

## Target Architecture
1. **Transaction State Machine**
   - Introduce `transaction-machine.ts` (XState or lightweight FSM) orchestrating `pending → persisting → retrying → completed/failed`.
   - Context stores mutation batch, retry count, last error, and resolver callbacks.
   - Events (`COMMIT`, `RESOLVE`, `RETRY`, `REJECT`, `CANCEL`) drive side effects.
   - Expose interpreter hooks so `OfflineExecutor` and `Collection` can subscribe.

2. **Utility Modules**
   - `optimisticState.ts`: pure helpers for merging/unmerging optimistic upserts/deletes.
   - `syncCommitter.ts`: reconcile pending synced transactions against the current state and produce change events.
   - `changeEmitter.ts`: manage batching, subscription, and `recentlySynced` filtering.
   - `outboxProcessor.ts`: wrap storage CRUD with transaction-machine events.

3. **Executor Composition**
   - `OfflineExecutor` becomes a thin orchestrator wiring storage, scheduler, and transaction interpreters.
   - `TransactionExecutor` splits into scheduling (`KeyScheduler`), runner (`mutationRunner.ts`), and retry policy service.
   - Leadership/connectivity listeners dispatch explicit events (e.g. `RESUME`, `PAUSE`) to interpreters to reset jitter or trigger execution.

4. **API Facade**
   - `OfflineTransaction`/`createOfflineAction` wrap the state machine while keeping the public API unchanged.
   - Promise handling (`waitForTransactionCompletion`) simply awaits the interpreter reaching `completed|failed`.

## Incremental Work Breakdown
1. **Preparation**
   - Trim debug logging across `packages/offline-transactions` & `packages/db`.
   - Add smoke tests around current behavior (retry path, online-only fallback, leadership loss) to guard refactor.

2. **Extract Utilities**
   - Move optimistic recompute logic into `packages/db/src/utils/optimisticState.ts` with unit tests.
   - Factor out sync reconciliation into `syncCommitter.ts` w/ tests covering truncate + optimistic overlay.
   - Decouple event batching logic into `changeEmitter.ts`.

3. **Introduce FSM**
   - Implement `transaction-machine.ts` mirroring current lifecycle.
   - Wrap existing `Transaction` class to drive the machine without changing external behavior.
   - Update `OfflineExecutor`/`TransactionExecutor` to interact via machine events (`COMMIT`, `RESOLVE`, `RETRY`).

4. **Executor Decomposition**
   - Split persistence and scheduling responsibilities into dedicated modules.
   - Replace promise-map wiring with interpreter listeners (e.g. `onTransition` hooks).
   - Simplify `OfflineTransaction` to start waiting immediately and release resources on interpreter completion.

5. **E2E Smoke Harness (Headless)**
   - Build an in-process test harness using fake adapters:
     - `FakeStorageAdapter`: in-memory Map with deterministic introspection.
     - `FakeOnlineDetector`: manual `setOnline(bool)` toggles; emits callbacks synchronously.
     - `FakeLeaderElection`: exposes `setLeader(bool)` to simulate multi-tab ownership.
     - `FakeMutationFn`: invokes injected “backend” function instead of network.
   - Wrap into a helper `createTestOfflineEnvironment()` returning executor, collection, and control handles.
   - Write Vitest suites covering:
     1. **Happy Path** – transaction persists while online; optimistic state resolves.
     2. **Offline Queue** – enqueue while offline, toggle online, ensure retries drain and state reconciles.
     3. **Retriable Failure** – backend throws `RetryableError` twice, succeeds on third try; waiting promises resolve once.
     4. **Permanent Failure** – backend throws `NonRetriableError`; optimistic changes roll back and waiters reject.
     5. **Leadership Handoff** – disable leader mid-run, ensure executor pauses and resolves pending waiters.
     6. **Restart Replay** – seed fake storage, start executor, verify transactions replay and clear.
   - Provide helpers to inspect outbox contents, transaction states, emitted collection events to assert outcomes without Playwright.

6. **Testing & Tooling**
   - Expand Vitest coverage: transaction machine, retry policy, offline executor integration, useLiveQuery optimistic sync, leveraging the fake environment.
   - Introduce debug tooling (`__DEV__` gated logging or devtools integration) replacing ad-hoc `console.log`s.

7. **Docs & Migration**
   - Document new module responsibilities and state-machine events.
   - Provide a troubleshooting guide for common offline issues (stuck retries, leadership conflicts).
   - Publish API notes confirming no breaking changes for end users.

## Risks & Mitigations
- **Bundle size**: XState adds weight; evaluate `@xstate/fsm` or compile-time extraction to keep footprint minimal.
- **Behavior parity**: Incremental extraction with high test coverage should catch divergences; keep feature flags or shadow mode early on.
- **Team adoption**: Provide architecture docs and pairing sessions to onboard contributors to the new event-driven flow.

## Immediate Next Steps
1. Land current bugfix (waiter race) and remove temporary logging.
2. Add regression tests for offline retry waiters and online-only bypass.
3. Kick off utility extraction, starting with optimistic state recompute, before introducing XState.
