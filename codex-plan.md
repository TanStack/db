# Offline Transactions Implementation Plan

## Goals & Scope
- Deliver the RFC features for durable offline transaction persistence, retry orchestration, and optimistic state restoration without breaking existing TanStack DB APIs.
- Introduce a package at `packages/offline-transactions` housing storage, scheduling, leader-election, and developer hooks for offline-first mutations.
- Integrate with current transaction (`packages/db/src/transactions.ts`) and collection (`packages/db/src/collection.ts`) flows so optimistic updates behave identically online/offline.

## Core Concepts
- **OfflineTransactionRecord**: Serialized snapshot persisted in storage. Fields mirror RFC schema (`id`, `mutatorName`, `mutations`, `keys`, `idempotencyKey`, `createdAt`, `retryCount`, `nextAttemptAt`, `lastError`, `metadata`, `version`). Strip non-serializable references before storage and restore with registry data.
- **SerializedPendingMutation**: Plain object form of `PendingMutation` (see `packages/db/src/types.ts`). Must capture `collectionId`, `globalKey`, `type`, `key`, `changes`, `modified`, `original`, timestamps, optimistic flag, and `syncMetadata`.
- **OutboxStorageAdapter**: Async interface supporting `init`, `getAll`, `get`, `put`, `update`, `remove`, and transactional batch writes. Default IndexedDB adapter with localStorage + in-memory fallbacks.
- **OfflineExecutor**: Orchestrator returned by `startOfflineExecutor`. Handles storage init, replay, scheduling, retry, hooks, and API helpers.
- **Leader Controller**: Web Locks primary, BroadcastChannel fallback, ensuring only one tab processes retries.

## Integration Points
- Extend `Transaction` (`packages/db/src/transactions.ts`) to expose `idempotencyKey`, allow replacing `isPersisted` deferred, and preserve metadata on rehydrate.
- Add helper on `CollectionImpl` (`packages/db/src/collection.ts`) to register externally created transactions so optimistic state recomputes correctly and cleanup logic runs.
- Use `CollectionImpl.generateGlobalKey` and existing mutation builders for consistent key derivation.
- Reuse `NonRetriableError` (`packages/db/src/errors.ts:10`) for permanent failure handling.

## Implementation Steps
1. **Package Scaffolding**
   - Copy minimal build/test setup from `packages/db` (tsconfig, vite config, vitest setup) into `packages/offline-transactions`.
   - Create `package.json` exporting both ESM/CJS builds, declare dependency on `@tanstack/db`, and add build/test scripts.
   - Add `src/index.ts` exporting public API and stub README.

2. **Type & Utility Definitions**
   - `src/types.ts`: declare runtime interfaces (records, serialized mutations, scheduler config, adapter contract, executor API, hook signatures).
   - Utility modules for `deferred`, `backoff` (expo 1s→2s→4s→8s→16s→32s→60s), jitter, `retryAfter` parsing, safe JSON serialization, and error normalization.
   - Decide whether to depend on `packages/db/src/deferred.ts` or ship local equivalent to avoid private imports.

3. **Serialization Layer**
   - `src/serialization.ts`: convert between `Transaction`/`PendingMutation` instances and serializable forms. Capture `collectionId` from `mutation.collection.id` and validate schema version.
   - Handle schema evolution via `version` field and upgrade path (start at 1, provide guard + future hook).
   - Ensure `mutations` order is preserved and `keys` derived from `PendingMutation.globalKey`.

4. **Storage Adapters**
   - `src/storage/indexeddb.ts`: create object store keyed by transaction id with indexes on `nextAttemptAt`. Handle quota errors by throwing `StorageQuotaExceededError`.
   - `src/storage/local-storage.ts` fallback for browsers without IndexedDB; ensure atomic writes (serialize entire list) and guard against corruption.
   - `src/storage/memory.ts` for SSR/tests.
   - All adapters implement the adapter contract and surface stable errors the executor can react to.

5. **Executor Core (`src/executor.ts`)**
   - Accept configuration: `collections`, `mutators`, `storage`, `maxConcurrency`, `jitter`, `beforeRetry`, `onUnknownMutator`, `logger`, `timeProvider` for tests.
   - On `start`:
     - Initialize storage and load records.
     - Rehydrate optimistic state by creating ambient transactions, inserting them into registered collections, and recomputing state.
     - Schedule existing records based on `nextAttemptAt`.
   - Maintain queues keyed by transaction id, plus per-key locks to ensure sequential execution for overlapping keys.
   - Execution loop: choose runnable records (ready time <= now, keys unlocked, concurrency slot available), call matching mutator or collection handler, handle success/failure.
   - Success: remove record from storage, resolve transaction promise, notify collections to drop optimistic state.
   - Failure: if `NonRetriableError`, drop record and reject promise; otherwise increment retry count, compute backoff, update record, and trigger `beforeRetry` hook to allow rewrites/pruning.
   - Honor `Retry-After` headers via error metadata.
   - Provide public methods: `createOfflineTransaction`, `createOfflineAction`, `notifyOnline`, `removeFromOutbox`, `peekOutbox`, `shutdown` (optional).

6. **API Helpers**
   - `createOfflineTransaction`: wraps `createTransaction` with `autoCommit` defaulting true. Before calling `mutationFn`, persist serialized record via executor, but only after optimistic mutations recorded. Replace transaction's `isPersisted` deferred with executor-managed promise.
   - `createOfflineAction`: mirror `packages/db/src/optimistic-action.ts` logic but route through offline transaction creation.
   - Automatic collection integration: during executor start, register handlers that create offline transactions for direct `collection.insert/update/delete` calls (mutatorName defaults to collection id). Requires hooking into collection config to ensure mutation functions dispatch through executor.

7. **Leader Election & Online Detection**
   - `src/leader.ts`: attempt Web Locks; if unavailable, use BroadcastChannel heartbeat. Provide events for leadership changes.
   - Non-leader tabs still enqueue to storage but don't run scheduler; they listen for completion events to resolve promises.
   - Hook `navigator.onLine`, `visibilitychange`, and manual `notifyOnline()` to wake scheduler.

8. **Changes to @tanstack/db**
   - Update `Transaction` to accept optional `idempotencyKey` (persist on instance and expose in types; default to UUID if not provided).
   - Allow injecting custom deferred/resolver (add method to replace `isPersisted` promise or expose setter).
   - Expose helper on `CollectionImpl` to register external transaction (e.g., `registerExternalTransaction(transaction)` that handles `transactions.set`, `scheduleTransactionCleanup`, and recompute).
   - Ensure serialization metadata (timestamps, sequence numbers) can be set during rehydration (maybe make setters public or expose constructor overrides).

9. **Testing Strategy**
   - Unit tests in new package covering serialization roundtrips, storage adapters, retry math, `beforeRetry`, `NonRetriableError` handling, and per-key concurrency with fake timers.
   - Integration tests verifying rehydrated transactions restore optimistic state in collections, and commitments eventually resolve after mock mutator success.
   - Simulate multi-tab leadership by mocking Web Locks/BroadcastChannel to assert only leader schedules retries.
   - Add targeted tests in `packages/db` if new APIs are introduced (idempotency key propagation, register helper).

10. **Documentation & Examples**
    - Write README for the new package with quick start, storage requirements, and API docs.
    - Update docs (`docs/overview.md`, reference tree) with sections on `startOfflineExecutor`, offline actions, hooks, and error handling.
    - Add example integration (e.g. update `todo-app` demo) to showcase offline queue.

11. **Release Tasks**
    - Update root `package.json` overrides if necessary and ensure build pipeline includes new package.
    - Add Changeset entries for new package and supporting `@tanstack/db` changes.
    - Verify lint/test/build across repo succeeds.

## Risks & Mitigations
- **Serialization drift**: enforce schema validation and fail gracefully (drop/inform) when encountering unknown versions.
- **Infinite retries**: backoff cap + jitter, developer hooks to prune, support `NonRetriableError` for permanent failures.
- **Multi-tab conflicts**: rely on Web Locks; fallback heartbeat with timeouts to ensure dead leader detection.
- **Non-browser usage**: default to no-op executor when storage unavailable; provide memory adapter + SSR guardrails.

## Future Enhancements
- Background Sync / Service Worker hookups once base outbox stable.
- Telemetry hooks for monitoring.
- CLI/debug tools to inspect outbox contents.
