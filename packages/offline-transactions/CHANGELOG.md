# @tanstack/offline-transactions

## 0.1.3

### Patch Changes

- Fix dependency bundling issues by moving @tanstack/db to peerDependencies ([#766](https://github.com/TanStack/db/pull/766))

  **What Changed:**

  Moved `@tanstack/db` from regular dependencies to peerDependencies in:
  - `@tanstack/offline-transactions`
  - `@tanstack/query-db-collection`

  Removed `@opentelemetry/api` dependency from `@tanstack/offline-transactions`.

  **Why:**

  These extension packages incorrectly declared `@tanstack/db` as both a regular dependency AND a peerDependency simultaneously. This caused lock files to develop conflicting versions, resulting in multiple instances of `@tanstack/db` being installed in consuming applications.

  The fix removes `@tanstack/db` from regular dependencies and keeps it only as a peerDependency. This ensures only one version of `@tanstack/db` is installed in the dependency tree, preventing version conflicts.

  For local development, `@tanstack/db` remains in devDependencies so the packages can be built and tested independently.

- Updated dependencies [[`6c55e16`](https://github.com/TanStack/db/commit/6c55e16a2545b479b1d47f548b6846d362573d45), [`7805afb`](https://github.com/TanStack/db/commit/7805afb7286b680168b336e77dd4de7dd1b6f06a), [`1367756`](https://github.com/TanStack/db/commit/1367756d0a68447405c5f5c1a3cca30ab0558d74)]:
  - @tanstack/db@0.4.20

## 0.1.2

### Patch Changes

- Updated dependencies [[`75470a8`](https://github.com/TanStack/db/commit/75470a8297f316b4817601b2ea92cb9b21cc7829)]:
  - @tanstack/db@0.4.19

## 0.1.1

### Patch Changes

- Updated dependencies [[`f416231`](https://github.com/TanStack/db/commit/f41623180c862b58b4fa6415383dfdb034f84ee9), [`b1b8299`](https://github.com/TanStack/db/commit/b1b82994cb9765225129b5a19be06e9369e3158d)]:
  - @tanstack/db@0.4.18

## 0.1.0

### Minor Changes

- Add offline-transactions package with robust offline-first capabilities ([#559](https://github.com/TanStack/db/pull/559))

  New package `@tanstack/offline-transactions` provides a comprehensive offline-first transaction system with:

  **Core Features:**
  - Persistent outbox pattern for reliable transaction processing
  - Leader election for multi-tab coordination (Web Locks API with BroadcastChannel fallback)
  - Automatic storage capability detection with graceful degradation
  - Retry logic with exponential backoff and jitter
  - Sequential transaction processing (FIFO ordering)

  **Storage:**
  - Automatic fallback chain: IndexedDB → localStorage → online-only
  - Detects and handles private mode, SecurityError, QuotaExceededError
  - Custom storage adapter support
  - Diagnostic callbacks for storage failures

  **Developer Experience:**
  - TypeScript-first with full type safety
  - Comprehensive test suite (25 tests covering leader failover, storage failures, e2e scenarios)
  - Works in all modern browsers and server-side rendering environments

  **@tanstack/db improvements:**
  - Enhanced duplicate instance detection (dev-only, iframe-aware, with escape hatch)
  - Better environment detection for SSR and worker contexts

  Example usage:

  ```typescript
  import {
    startOfflineExecutor,
    IndexedDBAdapter,
  } from "@tanstack/offline-transactions"

  const executor = startOfflineExecutor({
    collections: { todos: todoCollection },
    storage: new IndexedDBAdapter(),
    mutationFns: {
      syncTodos: async ({ transaction, idempotencyKey }) => {
        // Sync mutations to backend
        await api.sync(transaction.mutations, idempotencyKey)
      },
    },
    onStorageFailure: (diagnostic) => {
      console.warn("Running in online-only mode:", diagnostic.message)
    },
  })

  // Create offline transaction
  const tx = executor.createOfflineTransaction({
    mutationFnName: "syncTodos",
    autoCommit: false,
  })

  tx.mutate(() => {
    todoCollection.insert({ id: "1", text: "Buy milk", completed: false })
  })

  await tx.commit() // Persists to outbox and syncs when online
  ```

### Patch Changes

- Updated dependencies [[`49bcaa5`](https://github.com/TanStack/db/commit/49bcaa5557ba8d647c947811ed6e0c2450159d84)]:
  - @tanstack/db@0.4.17
