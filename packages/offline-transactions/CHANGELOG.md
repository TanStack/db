# @tanstack/offline-transactions

## 1.0.6

### Patch Changes

- Updated dependencies [[`41308b8`](https://github.com/TanStack/db/commit/41308b8ee914aa467e22842cd454f06d1a60032e)]:
  - @tanstack/db@0.5.16

## 1.0.5

### Patch Changes

- Updated dependencies [[`32ec4d8`](https://github.com/TanStack/db/commit/32ec4d8478cca96f76f3a49efc259c95b85baa40)]:
  - @tanstack/db@0.5.15

## 1.0.4

### Patch Changes

- Updated dependencies [[`26ed0aa`](https://github.com/TanStack/db/commit/26ed0aad2def60e652508a99b2e980e73f70148e)]:
  - @tanstack/db@0.5.14

## 1.0.3

### Patch Changes

- Updated dependencies [[`8ed7725`](https://github.com/TanStack/db/commit/8ed7725514a6a501482a391162f7792aa8b371e5), [`01452bf`](https://github.com/TanStack/db/commit/01452bfd0d00da8bd52941a4954af73749473651)]:
  - @tanstack/db@0.5.13

## 1.0.2

### Patch Changes

- Updated dependencies [[`b3b1940`](https://github.com/TanStack/db/commit/b3b194000d8efcc2c6cc45a663029dadc26f13f0), [`09da081`](https://github.com/TanStack/db/commit/09da081b420fc915d7f0dc566c6cdbbc78582435), [`86ad40c`](https://github.com/TanStack/db/commit/86ad40c6bc37b2f5d4ad24d06f72168ca4b96161)]:
  - @tanstack/db@0.5.12

## 1.0.1

### Patch Changes

- Use regular dependency for @tanstack/db instead of peerDependency to match the standard pattern used by other TanStack DB packages and prevent duplicate installations ([#952](https://github.com/TanStack/db/pull/952))

- Updated dependencies [[`c4b9399`](https://github.com/TanStack/db/commit/c4b93997432743d974749683059bf68a082d3e5b), [`a1a484e`](https://github.com/TanStack/db/commit/a1a484ec4d2331d702ab9c4b7e5b02622c76b3dd)]:
  - @tanstack/db@0.5.11

## 1.0.0

### Patch Changes

- Updated dependencies [[`243a35a`](https://github.com/TanStack/db/commit/243a35a632ee0aca20c3ee12ee2ac2929d8be11d), [`f9d11fc`](https://github.com/TanStack/db/commit/f9d11fc3d7297c61feb3c6876cb2f436edbb5b34), [`7aedf12`](https://github.com/TanStack/db/commit/7aedf12996a67ef64010bca0d78d51c919dd384f), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`f6ac7ea`](https://github.com/TanStack/db/commit/f6ac7eac50ae1334ddb173786a68c9fc732848f9), [`01093a7`](https://github.com/TanStack/db/commit/01093a762cf2f5f308edec7f466d1c3dabb5ea9f)]:
  - @tanstack/db@0.5.0

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
  } from '@tanstack/offline-transactions'

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
      console.warn('Running in online-only mode:', diagnostic.message)
    },
  })

  // Create offline transaction
  const tx = executor.createOfflineTransaction({
    mutationFnName: 'syncTodos',
    autoCommit: false,
  })

  tx.mutate(() => {
    todoCollection.insert({ id: '1', text: 'Buy milk', completed: false })
  })

  await tx.commit() // Persists to outbox and syncs when online
  ```

### Patch Changes

- Updated dependencies [[`49bcaa5`](https://github.com/TanStack/db/commit/49bcaa5557ba8d647c947811ed6e0c2450159d84)]:
  - @tanstack/db@0.4.17
