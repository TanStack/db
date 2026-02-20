# @tanstack/offline-transactions

## 1.0.18

### Patch Changes

- Updated dependencies [[`46450e7`](https://github.com/TanStack/db/commit/46450e73bf78dbdcbef1fb46cb90c6a86b10f6c8)]:
  - @tanstack/db@0.5.28

## 1.0.17

### Patch Changes

- Updated dependencies [[`802550f`](https://github.com/TanStack/db/commit/802550f3c517b8decac273edf9a4a6074fb3526b), [`dc41d7d`](https://github.com/TanStack/db/commit/dc41d7dacc4a70cb62462633a375de823f01b280), [`4ff3da5`](https://github.com/TanStack/db/commit/4ff3da57e095dc17d8585585d7678b9538cf7602), [`2223cd6`](https://github.com/TanStack/db/commit/2223cd6b51ce37f21983302804a75af28b47f2fe)]:
  - @tanstack/db@0.5.27

## 1.0.16

### Patch Changes

- Updated dependencies [[`85c373e`](https://github.com/TanStack/db/commit/85c373ef892e4080fe86b26e2fcb762181545e3c), [`9184dcc`](https://github.com/TanStack/db/commit/9184dcce62019ea870f968f4a4a5c2428291214d), [`83d5ac8`](https://github.com/TanStack/db/commit/83d5ac82983fb6c244c53d349c83845969473a9b)]:
  - @tanstack/db@0.5.26

## 1.0.15

### Patch Changes

- Updated dependencies [[`43c7c9d`](https://github.com/TanStack/db/commit/43c7c9d5f2b47366a58f87470ac5dca95020ac57), [`284ebcc`](https://github.com/TanStack/db/commit/284ebcc8346bd237c3381de766995b8bda35009a)]:
  - @tanstack/db@0.5.25

## 1.0.14

### Patch Changes

- Updated dependencies [[`7099459`](https://github.com/TanStack/db/commit/7099459291810b237a9fb24bbfe6e543852a2ab2)]:
  - @tanstack/db@0.5.24

## 1.0.13

### Patch Changes

- Fix optimistic state not being restored to collections on page refresh while offline. Pending transactions are now automatically rehydrated from storage and their optimistic mutations applied to the UI immediately on startup, providing a seamless offline experience. ([#1169](https://github.com/TanStack/db/pull/1169))

- Updated dependencies [[`05130f2`](https://github.com/TanStack/db/commit/05130f2420eb682f11f099310a0af87afa3f35fe)]:
  - @tanstack/db@0.5.23

## 1.0.12

### Patch Changes

- Updated dependencies [[`f9b741e`](https://github.com/TanStack/db/commit/f9b741e9fb636be1c9f1502b7e28fe691bae2480)]:
  - @tanstack/db@0.5.22

## 1.0.11

### Patch Changes

- Fix date field corruption after app restart. String values matching ISO date format were incorrectly converted to Date objects during deserialization, corrupting user data. Now only explicit Date markers are converted, preserving string values intact. ([#1127](https://github.com/TanStack/db/pull/1127))

- Fix mutation.changes field being lost during offline transaction serialization. Previously, the changes field was not included in serialized mutations, causing it to be empty ({}) after app restart. This led to sync functions receiving incomplete data when using mutation.changes for partial updates. ([#1124](https://github.com/TanStack/db/pull/1124))

- Introduce specialized OnlineDetector for React Native ([#1137](https://github.com/TanStack/db/pull/1137))

- Updated dependencies [[`6745ed0`](https://github.com/TanStack/db/commit/6745ed003dc25cfd6fa0f7e60f708205a6069ff2), [`1b22e40`](https://github.com/TanStack/db/commit/1b22e40c56323cfa5e7f759272fed53320aa32f7), [`7a2cacd`](https://github.com/TanStack/db/commit/7a2cacd7a426530cb77844a8c2680f6b06e9ce2f), [`bdf9405`](https://github.com/TanStack/db/commit/bdf94059e7ab98b5181e0df7d8d25cd1dbb5ae58)]:
  - @tanstack/db@0.5.21

## 1.0.10

### Patch Changes

- Updated dependencies []:
  - @tanstack/db@0.5.20

## 1.0.9

### Patch Changes

- Updated dependencies [[`29033b8`](https://github.com/TanStack/db/commit/29033b8f55b0ba5721371ad761037ec813440aa7), [`888ad6a`](https://github.com/TanStack/db/commit/888ad6afe5932b0467320c04fbd4583469cb9c47)]:
  - @tanstack/db@0.5.19

## 1.0.8

### Patch Changes

- Updated dependencies [[`c1247e8`](https://github.com/TanStack/db/commit/c1247e816950314da6d201613481577834c1d97a)]:
  - @tanstack/db@0.5.18

## 1.0.7

### Patch Changes

- Fix race condition that caused double replay of offline transactions on page load. The issue occurred when WebLocksLeader's async lock acquisition triggered the leadership callback after requestLeadership() had already returned, causing loadAndReplayTransactions() to be called twice. ([#1046](https://github.com/TanStack/db/pull/1046))

- Updated dependencies [[`f795a67`](https://github.com/TanStack/db/commit/f795a674f21659ef46ff370d4f3b9903a596bcaf), [`d542667`](https://github.com/TanStack/db/commit/d542667a3440415d8e6cbb449b20abd3cbd6855c), [`6503c09`](https://github.com/TanStack/db/commit/6503c091a259208331f471dca29abf086e881147), [`b1cc4a7`](https://github.com/TanStack/db/commit/b1cc4a7e018ffb6804ae7f1c99e9c6eb4bb22812)]:
  - @tanstack/db@0.5.17

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
