# TanStack DB — Built-in Test Inventory

This is a supporting reference for the `db-core/testing` skill. It lists every
test file in the TanStack DB monorepo grouped by package and area.

## Summary

| Area | Files | Focus |
|------|-------|-------|
| Collection Core | ~15 | CRUD, lifecycle, events, errors, schemas, indexes |
| Query System | ~30 | Builder, compiler, optimizer, operators, joins |
| IVM Operators | ~27 | filter, join, orderBy, groupBy, topK, etc. |
| Framework Hooks | 5 | React, Vue, Svelte, Solid, Angular |
| Persistence | ~20 | SQLite adapters (Node, Browser, Electron, React Native) |
| Offline Sync | 8 | Transaction queuing, failover, leader election |
| Integrations | ~6 | Electric, PowerSync, RxDB, TrailBase, Query |

**Total: 166+ test files**

---

## Core Database (`@tanstack/db`)

Location: `packages/db/tests/`

### Collection tests

| File | What it tests |
|------|---------------|
| `collection.test.ts` | Creation, CRUD, bulk ops, transactions, truncate, error handling (~1700 lines) |
| `collection-events.test.ts` | Status change, subscriber count, index lifecycle events, `on`/`once`/`off`/`waitFor` |
| `collection-schema.test.ts` | Zod/ArkType validation, transforms, defaults, type inference |
| `collection-getters.test.ts` | `state`, `size`, `has`, `keys`, `values`, `entries`, `get`, `stateWhenReady`, `toArray` |
| `collection-errors.test.ts` | Cleanup errors, stack preservation, state transition validation |
| `collection-indexes.test.ts` | Index creation/removal, signature stability, canonicalization, partial indexes |
| `collection-auto-index.test.ts` | Auto-indexing behavior, query optimization with auto-indexes |
| `collection-subscribe-changes.test.ts` | Change subscription, event aggregation, batching |
| `collection-subscription.test.ts` | Subscription mechanics |
| `collection-lifecycle.test.ts` | Lifecycle states, startup, shutdown, error recovery |
| `collection-change-events.test.ts` | Change event handling, propagation |
| `collection-truncate.test.ts` | Truncate operations with sync transactions |
| `collection-subscriber-duplicate-inserts.test.ts` | Duplicate insert handling in subscriber scenarios |
| `collection.test-d.ts` | TypeScript type definition tests |

### Query tests

| File | What it tests |
|------|---------------|
| `query/basic.test.ts` | Basic query construction, SELECT, WHERE, FROM |
| `query/builder/buildQuery.test.ts` | Query builder construction |
| `query/builder/join.test.ts` | JOIN operations |
| `query/builder/from.test.ts` | FROM clause |
| `query/builder/where.test.ts` | WHERE clause |
| `query/builder/order-by.test.ts` | ORDER BY |
| `query/builder/group-by.test.ts` | GROUP BY |
| `query/builder/select.test.ts` | SELECT clause |
| `query/builder/ref-proxy.test.ts` | Reference proxy patterns |
| `query/builder/functional-variants.test.ts` | Functional query variants |
| `query/builder/functions.test.ts` | Query functions |
| `query/compiler/basic.test.ts` | Query compilation |
| `query/compiler/evaluators.test.ts` | Expression evaluators |
| `query/compiler/group-by.test.ts` | GROUP BY compilation |
| `query/compiler/select.test.ts` | SELECT compilation |
| `query/compiler/subqueries.test.ts` | Subquery compilation |
| `query/compiler/subquery-caching.test.ts` | Subquery caching optimization |
| `query/composables.test.ts` | Reusable query composition |
| `query/distinct.test.ts` | DISTINCT operations |
| `query/expression-helpers.test.ts` | Expression helper functions |
| `query/functional-variants.test.ts` | Functional query variants |
| `query/group-by.test.ts` | GROUP BY queries |
| `query/indexes.test.ts` | Query index usage |
| `query/join.test.ts` | JOIN operations |
| `query/join-subquery.test.ts` | Subquery JOINs |
| `query/live-query-collection.test.ts` | Live query collections |
| `query/load-subset-subquery.test.ts` | Subset loading in subqueries |
| `query/optimistic-delete-with-limit.test.ts` | Optimistic delete with LIMIT |
| `query/optimizer.test.ts` | Query optimization |
| `query/optional-fields-runtime.test.ts` | Optional field handling |
| `query/order-by.test.ts` | ORDER BY execution |
| `query/predicate-utils.test.ts` | Predicate utility functions |
| `query/query-once.test.ts` | One-shot query execution |
| `query/query-while-syncing.test.ts` | Querying during sync |
| `query/scheduler.test.ts` | Query scheduling |
| `query/select.test.ts` | SELECT execution |
| `query/select-spread.test.ts` | SELECT with spread |
| `query/subquery.test.ts` | Subquery handling |
| `query/subset-dedupe.test.ts` | Subset deduplication |
| `query/validate-aliases.test.ts` | Alias validation |
| `query/where.test.ts` | WHERE execution |

### Infrastructure tests

| File | What it tests |
|------|---------------|
| `apply-mutations.test.ts` | Mutation application logic |
| `btree-index-undefined-values.test.ts` | BTree index with undefined values |
| `cleanup-queue.test.ts` | Cleanup queue management |
| `cursor.test.ts` | Cursor operations |
| `cursor.property.test.ts` | Property-based cursor tests |
| `comparison.property.test.ts` | Property-based comparison tests |
| `deferred.test.ts` | Deferred execution |
| `deterministic-ordering.test.ts` | Deterministic ordering guarantees |
| `effect.test.ts` | Side-effect handling |
| `errors.test.ts` | Error handling |
| `local-only.test.ts` | Local-only operations |
| `local-storage.test.ts` | LocalStorage operations |
| `optimistic-action.test.ts` | Optimistic action patterns |
| `paced-mutations.test.ts` | Paced mutation operations |
| `proxy.test.ts` | Proxy object patterns |
| `SortedMap.test.ts` | SortedMap data structure |
| `transaction-types.test.ts` | Transaction type checking |
| `transactions.test.ts` | Transaction operations |
| `utils.property.test.ts` | Property-based utility tests |
| `utils.test.ts` | Utility functions |
| `utility-exposure.test.ts` | Public utility exposure validation |
| `integration/uint8array-id-comparison.test.ts` | UInt8Array ID comparison |

---

## IVM (`@tanstack/db-ivm`)

Location: `packages/db-ivm/tests/`

### Core

| File | What it tests |
|------|---------------|
| `graph.test.ts` | DifferenceStreamReader/Writer, queue, multi-reader |
| `multiset.test.ts` | MultiSet data structure |
| `indexes.test.ts` | Index structures |
| `hash.property.test.ts` | Property-based hash testing |
| `utils.test.ts` | Utility functions |

### Operators (27 files in `operators/`)

`concat`, `consolidate`, `count`, `debug`, `distinct`, `filter`, `filterBy`,
`groupBy`, `groupedOrderByWithFractionalIndex`, `groupedTopKWithFractionalIndex`,
`join`, `join-types`, `keying`, `keying-types`, `map`, `negate`, `orderBy`,
`orderByWithFractionalIndex`, `orderByWithIndex`, `output`, `pipe`, `reduce`,
`topK`, `topKWithFractionalIndex`, `topKWithIndex`

---

## Framework Hooks

| Package | File | What it tests |
|---------|------|---------------|
| `@tanstack/react-db` | `useLiveQuery.test.tsx` | React hook with renderHook/waitFor |
| `@tanstack/react-db` | `useLiveInfiniteQuery.test.tsx` | Infinite pagination |
| `@tanstack/react-db` | `useLiveSuspenseQuery.test.tsx` | Suspense integration |
| `@tanstack/react-db` | `useLiveQueryEffect.test.tsx` | useEffect-based queries |
| `@tanstack/react-db` | `usePacedMutations.test.tsx` | Paced mutations hook |
| `@tanstack/vue-db` | `useLiveQuery.test.ts` | Vue 3 composition API |
| `@tanstack/svelte-db` | `useLiveQuery.svelte.test.ts` | Svelte 5 runes |
| `@tanstack/solid-db` | `useLiveQuery.test.tsx` | Solid.js reactive primitives |
| `@tanstack/angular-db` | `inject-live-query.test.ts` | Angular inject() pattern |

---

## Persistence

### SQLite Core (`@tanstack/db-sqlite-persisted-collection-core`)

| File | What it tests |
|------|---------------|
| `sqlite-core-adapter.test.ts` | SQLite adapter operations |
| `sqlite-core-adapter-cli-runtime.test.ts` | CLI runtime compatibility |
| `persisted.test.ts` | Persistence adapter interface, recording adapter |

### Node SQLite (`@tanstack/db-node-sqlite-persisted-collection`)

| File | What it tests |
|------|---------------|
| `node-driver.test.ts` | Node.js SQLite driver |
| `node-persistence.test.ts` | Node.js persistence layer |
| `node-sqlite-core-adapter-contract.test.ts` | Core adapter contract compliance |
| `node-persisted-collection.e2e.test.ts` | End-to-end node persistence |

### Browser WA-SQLite (`@tanstack/db-browser-wa-sqlite-persisted-collection`)

| File | What it tests |
|------|---------------|
| `wa-sqlite-driver.test.ts` | WebAssembly SQLite driver |
| `browser-persistence.test.ts` | Browser persistence |
| `browser-single-tab.test.ts` | Single-tab scenarios |
| `browser-coordinator.test.ts` | Browser coordinator |
| `opfs-database.test.ts` | OPFS database |
| `browser-single-tab-persisted-collection.e2e.test.ts` | End-to-end browser tests |

### Electron SQLite (`@tanstack/db-electron-sqlite-persisted-collection`)

| File | What it tests |
|------|---------------|
| `electron-ipc.test.ts` | Electron IPC communication |
| `electron-sqlite-core-adapter-contract.test.ts` | Core adapter contract |
| `electron-runtime-bridge.e2e.test.ts` | Runtime bridge E2E |
| `electron-persisted-collection.e2e.test.ts` | Electron persistence E2E |

### React Native SQLite (`@tanstack/db-react-native-sqlite-persisted-collection`)

| File | What it tests |
|------|---------------|
| `op-sqlite-driver.test.ts` | Op SQLite driver |
| `react-native-persistence.test.ts` | React Native persistence |
| `expo-sqlite-core-adapter-contract.test.ts` | Expo SQLite adapter |
| `react-native-sqlite-core-adapter-contract.test.ts` | React Native SQLite adapter |
| `mobile-runtime-persistence-contract.test.ts` | Mobile runtime contract |
| `expo-persisted-collection.e2e.test.ts` | Expo persistence E2E |
| `react-native-persisted-collection.e2e.test.ts` | React Native persistence E2E |

---

## Integration Packages

### Electric SQL (`@tanstack/electric-db-collection`)

| File | What it tests |
|------|---------------|
| `electric.test.ts` | Electric integration, ShapeStream mocking, change subscription |
| `electric-live-query.test.ts` | Live queries with Electric |
| `tags.test.ts` | Tag handling |
| `pg-serializer.test.ts` | PostgreSQL serialization |
| `pg-serializer.property.test.ts` | Property-based serializer tests |
| `sql-compiler.test.ts` | SQL compilation |
| `electric.e2e.test.ts` | End-to-end Electric |

### PowerSync (`@tanstack/powersync-db-collection`)

| File | What it tests |
|------|---------------|
| `powersync.test.ts` | PowerSync integration |
| `collection-schema.test.ts` | PowerSync schema |
| `schema.test.ts` | Schema definitions |
| `load-hooks.test.ts` | Load hook callbacks |
| `on-demand-sync.test.ts` | On-demand synchronization |
| `sqlite-compiler.test.ts` | SQLite compilation |

### Others

| Package | File | What it tests |
|---------|------|---------------|
| `@tanstack/query-db-collection` | `query.test.ts` | Query collection operations |
| `@tanstack/query-db-collection` | `query.e2e.test.ts` | Query collection E2E |
| `@tanstack/rxdb-db-collection` | `rxdb.test.ts` | RxDB integration |
| `@tanstack/trailbase-db-collection` | `trailbase.test.ts` | TrailBase integration |
| `@tanstack/trailbase-db-collection` | `trailbase.e2e.test.ts` | TrailBase E2E |

---

## Offline Transactions (`@tanstack/offline-transactions`)

Location: `packages/offline-transactions/tests/`

| File | What it tests |
|------|---------------|
| `OfflineExecutor.test.ts` | Executor creation, offline transactions, outbox |
| `KeyScheduler.test.ts` | Key-based scheduling |
| `OnlineDetector.test.ts` | Browser online detection |
| `ReactNativeOnlineDetector.test.ts` | React Native online detection |
| `TransactionSerializer.test.ts` | Transaction serialization |
| `storage-failure.test.ts` | Storage failure scenarios |
| `leader-failover.test.ts` | Multi-tab leader election, failover |
| `offline-e2e.test.ts` | End-to-end offline scenarios |

---

## Testing Patterns Used Across the Suite

| Pattern | Where | Example |
|---------|-------|---------|
| `mockSyncCollectionOptions()` | All core + framework tests | Creates controlled sync with initial data |
| `stripVirtualProps()` | Core tests | Removes `$synced`, `$origin`, `$key`, `$collectionId` |
| `createIndexUsageTracker()` | Index/query optimizer tests | Monitors index method calls |
| `flushPromises()` | Async tests | `new Promise(resolve => setTimeout(resolve, 0))` |
| `withExpectedRejection()` | Error tests | Suppresses expected unhandled rejections |
| `vi.fn()` / `vi.mock()` | Integration tests | Mocks for ShapeStream, APIs, etc. |
| `.property.test.ts` files | Core + IVM | Property-based testing (fast-check) |
| `.e2e.test.ts` files | Persistence + integrations | Full integration across subsystems |
| `.test-d.ts` files | Core | TypeScript type definition tests |
