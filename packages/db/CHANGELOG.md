# @tanstack/db

## 0.5.29

### Patch Changes

- fix: avoid DuplicateKeySyncError in join live queries when custom getKey only considers the identity of one of the joined collections ([#1290](https://github.com/TanStack/db/pull/1290))

- fix: support aggregates nested inside expressions (e.g. `coalesce(count(...), 0)`) ([#1274](https://github.com/TanStack/db/pull/1274))

## 0.5.28

### Patch Changes

- Fix isNull predicate causing LiveQuery to never become ready when offline. Reorder predicate checks in `isWhereSubsetInternal` so OR superset handling runs before AND subset decomposition, allowing `and(eq, isNull)` to match structurally equal disjuncts. Also separate `forceDisconnectAndRefresh` error handling into its own try-catch with correct error attribution. ([#1275](https://github.com/TanStack/db/pull/1275))

## 0.5.27

### Patch Changes

- fix(db): don't push WHERE clauses to nullable side of outer joins ([#1254](https://github.com/TanStack/db/pull/1254))

  The query optimizer incorrectly pushed single-source WHERE clauses into subqueries and collection index optimization for the nullable side of outer joins. This pre-filtered the data before the join, converting rows that should have been excluded by the WHERE into unmatched outer-join rows that incorrectly survived the residual filter.

- Fixed `acceptMutations` not persisting data in local-only collections with manual transactions. The mutation filter was comparing against a stale `null` collection reference instead of using the collection ID, causing all mutations to be silently dropped after the transaction's `mutationFn` resolved. ([#1253](https://github.com/TanStack/db/pull/1253))

- Fix like/ilike `%` and `_` not matching newline characters ([#1263](https://github.com/TanStack/db/pull/1263))

- Make type of collection utils more precise for localOnly, PowerSync, Trailbase, and Electric collections ([#1236](https://github.com/TanStack/db/pull/1236))

## 0.5.26

### Patch Changes

- fix: export types used in public API signatures for declaration emit compatibility ([#1231](https://github.com/TanStack/db/pull/1231))

  Types like `SchemaFromSource`, `MergeContextWithJoinType`, `WithResult`, `ResultTypeFromSelect`, and others
  are used in the public method signatures of `BaseQueryBuilder` (e.g. `from()`, `join()`, `select()`) but
  were not re-exported from the package's public API. This caused TypeScript error TS2742 when consumers used
  `declaration: true` in their tsconfig, as TypeScript could not name the inferred types in generated `.d.ts` files.

  Fixes #1012

- Fix `useLiveInfiniteQuery` peek-ahead detection for `hasNextPage`. The initial query now correctly requests `pageSize + 1` items to detect whether additional pages exist, matching the behavior of subsequent page loads. ([#1209](https://github.com/TanStack/db/pull/1209))

  Fix async on-demand pagination by ensuring the graph callback fires at least once even when there is no pending graph work, so that `loadMoreIfNeeded` is triggered after `setWindow()` increases the limit.

- Fix `eq()` with Date objects in join conditions and `inArray()` with Date values in WHERE clauses by normalizing values via `normalizeValue` (#934) ([#1229](https://github.com/TanStack/db/pull/1229))

## 0.5.25

### Patch Changes

- Fixed infinite loop in `BTreeIndex.takeInternal` when indexed values are `undefined`. ([#1198](https://github.com/TanStack/db/pull/1198))

  The BTree uses `undefined` as a special parameter meaning "start from beginning/end", which caused an infinite loop when the actual indexed value was `undefined`.

  Added `takeFromStart` and `takeReversedFromEnd` methods to explicitly start from the beginning/end, and introduced a sentinel value for storing `undefined` in the BTree.

- Fix `isReady` tracking for on-demand live queries without orderBy. Previously, non-ordered live queries using `syncMode: 'on-demand'` were incorrectly marked as ready before data finished loading. Also fix `preload()` promises hanging when cleanup occurs before the collection becomes ready. Additionally, fix concurrent live queries subscribing to the same source collection - each now independently tracks loading state. ([#1192](https://github.com/TanStack/db/pull/1192))

## 0.5.24

### Patch Changes

- Fix `$selected` namespace availability in `orderBy`, `having`, and `fn.having` when using `fn.select`. Previously, the `$selected` namespace was only available when using regular `.select()`, not functional `fn.select()`. ([#1183](https://github.com/TanStack/db/pull/1183))

## 0.5.23

### Patch Changes

- Fix bug that caused the WHERE clause of a subquery not to be passed to the `loadSubset` function ([#1097](https://github.com/TanStack/db/pull/1097))

## 0.5.22

### Patch Changes

- Fix `gcTime: Infinity` causing immediate garbage collection instead of disabling GC. JavaScript's `setTimeout` coerces `Infinity` to `0` via ToInt32, so we now explicitly check for non-finite values. ([#1135](https://github.com/TanStack/db/pull/1135))

## 0.5.21

### Patch Changes

- Clarify queueStrategy error handling behavior in documentation. Changed "guaranteed to persist" to "guaranteed to be attempted" and added explicit documentation about how failed mutations are handled (not retried, queue continues). Added new Retry Behavior section with example code for implementing custom retry logic. ([#1107](https://github.com/TanStack/db/pull/1107))

- Improve DuplicateKeySyncError message when using `.distinct()` with custom `getKey`. The error now explains that `.distinct()` deduplicates by the entire selected object, and provides actionable guidance to fix the issue. ([#1119](https://github.com/TanStack/db/pull/1119))

- Fix syncedData not updating when manual write operations (writeUpsert, writeInsert, etc.) are called after async operations in mutation handlers. Previously, the sync transaction would be blocked by the persisting user transaction, leaving syncedData stale until the next sync cycle. ([#1130](https://github.com/TanStack/db/pull/1130))

- Add string support to `min()` and `max()` aggregate functions. These functions now work with strings using lexicographic comparison, matching standard SQL behavior. ([#1120](https://github.com/TanStack/db/pull/1120))

- Updated dependencies [[`bdf9405`](https://github.com/TanStack/db/commit/bdf94059e7ab98b5181e0df7d8d25cd1dbb5ae58)]:
  - @tanstack/db-ivm@0.1.17

## 0.5.20

### Patch Changes

- Updated dependencies [[`f5b504e`](https://github.com/TanStack/db/commit/f5b504e6d105034d23cb2ae27782e8cba0094cbe)]:
  - @tanstack/db-ivm@0.1.16

## 0.5.19

### Patch Changes

- Fix `isReady()` returning `true` while `toArray()` returns empty results. The status now correctly waits until data has been processed through the graph before marking ready. ([#1114](https://github.com/TanStack/db/pull/1114))

  Also fix duplicate key errors when live queries use joins with custom `getKey` functions. D2's incremental join can produce multiple outputs for the same key during a single graph run; this change batches all outputs into a single transaction to prevent conflicts.

- Introduce $selected namespace for accessing fields from SELECT clause inside ORDER BY and HAVING clauses. ([#1094](https://github.com/TanStack/db/pull/1094))

- Updated dependencies [[`2456adb`](https://github.com/TanStack/db/commit/2456adbdb78b01d3f7323b3a0405b25f578df956)]:
  - @tanstack/db-ivm@0.1.15

## 0.5.18

### Patch Changes

- fix(db): prevent live query from being marked ready before subset data is loaded ([#1081](https://github.com/TanStack/db/pull/1081))

  In on-demand sync mode, the live query collection was being marked as `ready` before
  the subset data finished loading. This caused `useLiveQuery` to return `isReady=true`
  with empty data, and `useLiveSuspenseQuery` to release suspense prematurely.

  The root cause was a race condition: the `status:change` listener in `CollectionSubscriber`
  was registered _after_ the snapshot was triggered. If `loadSubset` resolved quickly
  (or synchronously), the `loadingSubset` status transition would be missed entirely,
  so `trackLoadPromise` was never called on the live query collection.

  Changes:
  1. **Core fix - `onStatusChange` option**: Added `onStatusChange` callback option to
     `subscribeChanges()`. The listener is registered BEFORE any snapshot is requested,
     guaranteeing no status transitions are missed. This replaces the error-prone pattern
     of manually deferring snapshots and registering listeners in the correct order.
  2. **Ready state gating**: `updateLiveQueryStatus()` now checks `isLoadingSubset` on the
     live query collection before marking it ready, and listens for `loadingSubset:change`
     to trigger the ready check when subset loading completes.

## 0.5.17

### Patch Changes

- Export `QueryResult` helper type for easily extracting query result types (similar to Zod's `z.infer`). ([#1096](https://github.com/TanStack/db/pull/1096))

  ```typescript
  import { Query, QueryResult } from '@tanstack/db'

  const myQuery = new Query()
    .from({ users })
    .select(({ users }) => ({ name: users.name }))

  // Extract the result type - clean and simple!
  type MyQueryResult = QueryResult<typeof myQuery>
  ```

  Also exports `ExtractContext` for advanced use cases where you need the full context type.

- Add validation for where() and having() expressions to catch JavaScript operator usage ([#1082](https://github.com/TanStack/db/pull/1082))

  When users accidentally use JavaScript's comparison operators (`===`, `!==`, `<`, `>`, etc.) in `where()` or `having()` callbacks instead of query builder functions (`eq`, `gt`, etc.), the query builder now throws a helpful `InvalidWhereExpressionError` with clear guidance.

  Previously, this mistake would result in a confusing "Unknown expression type: undefined" error at query compilation time. Now users get immediate feedback with an example of the correct syntax:

  ```
  ❌ .where(({ user }) => user.id === 'abc')
  ✅ .where(({ user }) => eq(user.id, 'abc'))
  ```

- Fix asymmetric behavior in `deepEquals` when comparing different special types (Date, RegExp, Map, Set, TypedArray, Temporal, Array). Previously, comparing values like `deepEquals(Date, Temporal.Duration)` could return a different result than `deepEquals(Temporal.Duration, Date)`. Now both directions correctly return `false` for mismatched types, ensuring `deepEquals` is a proper equivalence relation. ([#1018](https://github.com/TanStack/db/pull/1018))

- Add `where` callback option to `subscribeChanges` for ergonomic filtering ([#943](https://github.com/TanStack/db/pull/943))

  Instead of manually constructing IR with `PropRef`:

  ```ts
  import { eq, PropRef } from '@tanstack/db'
  collection.subscribeChanges(callback, {
    whereExpression: eq(new PropRef(['status']), 'active'),
  })
  ```

  You can now use a callback with query builder functions:

  ```ts
  import { eq } from '@tanstack/db'
  collection.subscribeChanges(callback, {
    where: (row) => eq(row.status, 'active'),
  })
  ```

## 0.5.16

### Patch Changes

- Fix useLiveInfiniteQuery not updating when deleting an item from a partial page with DESC order. ([#970](https://github.com/TanStack/db/pull/970))

  The bug occurred when using `useLiveInfiniteQuery` with `orderBy(..., 'desc')` and having fewer items than the `pageSize`. Deleting an item would not update the live result - the deleted item would remain visible until another change occurred.

  The root cause was in `requestLimitedSnapshot` where `biggestObservedValue` was incorrectly set to the full row object instead of the indexed value (e.g., the salary field used for ordering). This caused the BTree comparison to fail, resulting in the same data being loaded multiple times with each item having a multiplicity > 1. When an item was deleted, its multiplicity would decrement but not reach 0, so it remained visible.

## 0.5.15

### Patch Changes

- fix: prevent duplicate inserts from reaching D2 pipeline in live queries ([#1054](https://github.com/TanStack/db/pull/1054))

  Added defensive measures to prevent duplicate INSERT events from reaching the D2 (differential dataflow) pipeline, which could cause items to not disappear when deleted (due to multiplicity going from 2 to 1 instead of 1 to 0).

  Changes:
  - Added `sentToD2Keys` tracking in `CollectionSubscriber` to filter duplicate inserts at the D2 pipeline entry point
  - Fixed `includeInitialState` handling to only pass when `true`, preventing internal lazy-loading subscriptions from incorrectly disabling filtering
  - Clear `sentToD2Keys` on truncate to allow re-inserts after collection reset

## 0.5.14

### Patch Changes

- Fix subscriptions not re-requesting data after truncate in on-demand sync mode. When a must-refetch occurs, subscriptions now buffer changes and re-request their previously loaded subsets, preventing a flash of missing content. ([#1043](https://github.com/TanStack/db/pull/1043))

  Key improvements:
  - Buffer changes atomically: deletes and inserts are emitted together in a single callback
  - Correct event ordering: defers loadSubset calls to a microtask so truncate deletes are buffered before refetch inserts
  - Gated on on-demand mode: only buffers when there's an actual loadSubset handler
  - Fixes delete filter edge case: skips delete filter during truncate buffering when `sentKeys` is empty

## 0.5.13

### Patch Changes

- Allow rows to be deleted by key by using the write function passed to a collection's sync function. ([#1003](https://github.com/TanStack/db/pull/1003))

- fix: deleted items not disappearing from live queries with `.limit()` ([#1044](https://github.com/TanStack/db/pull/1044))

  Fixed a bug where deleting an item from a live query with `.orderBy()` and `.limit()` would not remove it from the query results. The `subscribeChanges` callback would never fire with a delete event.

  The issue was caused by duplicate inserts reaching the D2 pipeline, which corrupted the multiplicity tracking used by `TopKWithFractionalIndexOperator`. A delete would decrement multiplicity from 2 to 1 instead of 1 to 0, so the item remained visible.

  Fixed by ensuring `sentKeys` is updated before callbacks execute (preventing race conditions) and filtering duplicate inserts in `filterAndFlipChanges`.

## 0.5.12

### Patch Changes

- Enhanced LoadSubsetOptions with separate cursor expressions and offset for flexible pagination. ([#960](https://github.com/TanStack/db/pull/960))

  **⚠️ Breaking Change for Custom Sync Layers / Query Collections:**

  `LoadSubsetOptions.where` no longer includes cursor expressions for pagination. If you have a custom sync layer or query collection that implements `loadSubset`, you must now handle pagination separately:
  - **Cursor-based pagination:** Use the new `cursor` property (`cursor.whereFrom` and `cursor.whereCurrent`) and combine them with `where` yourself
  - **Offset-based pagination:** Use the new `offset` property

  Previously, cursor expressions were baked into the `where` clause. Now they are passed separately so sync layers can choose their preferred pagination strategy.

  **Changes:**
  - Added `CursorExpressions` type with `whereFrom`, `whereCurrent`, and optional `lastKey` properties
  - Added `cursor` to `LoadSubsetOptions` for cursor-based pagination (separate from `where`)
  - Added `offset` to `LoadSubsetOptions` for offset-based pagination support
  - Electric sync layer now makes two parallel `requestSnapshot` calls when cursor is present:
    - One for `whereCurrent` (all ties at boundary, no limit)
    - One for `whereFrom` (rows after cursor, with limit)
  - Query collection serialization now includes `offset` for query key generation
  - Added `truncate` event to collections, emitted when synced data is truncated (e.g., after `must-refetch`)
  - Fixed `setWindow` pagination: cursor expressions are now correctly built when paging through results
  - Fixed offset tracking: `loadNextItems` now passes the correct window offset to prevent incorrect deduplication
  - `CollectionSubscriber` now listens for `truncate` events to reset cursor tracking state

  **Benefits:**
  - Sync layers can choose between cursor-based or offset-based pagination strategies
  - Electric can efficiently handle tie-breaking with two targeted requests
  - Better separation of concerns between filtering (`where`) and pagination (`cursor`/`offset`)
  - `setWindow` correctly triggers backend loading for subsequent pages in multi-column orderBy queries
  - Cursor state is properly reset after truncation, preventing stale cursor data from being used

- Ensure deterministic iteration order for collections and indexes. ([#958](https://github.com/TanStack/db/pull/958))

  **SortedMap improvements:**
  - Added key-based tie-breaking when values compare as equal, ensuring deterministic ordering
  - Optimized to skip value comparison entirely when no comparator is provided (key-only sorting)
  - Extracted `compareKeys` utility to `utils/comparison.ts` for reuse

  **BTreeIndex improvements:**
  - Keys within the same indexed value are now returned in deterministic sorted order
  - Optimized with fast paths for empty sets and single-key sets to avoid unnecessary allocations

  **CollectionStateManager changes:**
  - Collections now always use `SortedMap` for `syncedData`, ensuring deterministic iteration order
  - When no `compare` function is provided, entries are sorted by key only

  This ensures that live queries with `orderBy` and `limit` produce stable, deterministic results even when multiple rows have equal sort values.

- Enhanced multi-column orderBy support with lazy loading and composite cursor optimization. ([#926](https://github.com/TanStack/db/pull/926))

  **Changes:**
  - Create index on first orderBy column even for multi-column orderBy queries, enabling lazy loading with first-column ordering
  - Pass multi-column orderBy to loadSubset with precise composite cursors (e.g., `or(gt(col1, v1), and(eq(col1, v1), gt(col2, v2)))`) for backend optimization
  - Use wide bounds (first column only) for local index operations to ensure no rows are missed
  - Use precise composite cursor for sync layer loadSubset to minimize data transfer

  **Benefits:**
  - Multi-column orderBy queries with limit now support lazy loading (previously disabled)
  - Sync implementations (like Electric) can optimize queries using composite indexes on the backend
  - Local collection uses first-column index efficiently while backend gets precise cursor

- Updated dependencies [[`52c29fa`](https://github.com/TanStack/db/commit/52c29fa83b390ac26341dbf93e79ce0d59543686)]:
  - @tanstack/db-ivm@0.1.14

## 0.5.11

### Patch Changes

- fix(db): compile filter expression once in createFilterFunctionFromExpression ([#954](https://github.com/TanStack/db/pull/954))

  Fixed a performance issue in `createFilterFunctionFromExpression` where the expression was being recompiled on every filter call. This only affected realtime change event filtering for pushed-down predicates at the collection level when using orderBy + limit. The core query engine was not affected as it already compiled predicates once.

- fix(query-db-collection): use deep equality for object field comparison in query observer ([#967](https://github.com/TanStack/db/pull/967))

  Fixed an issue where updating object fields (non-primitives) with `refetch: false` in `onUpdate` handlers would cause the value to rollback to the previous state every other update. The query observer was using shallow equality (`===`) to compare items, which compares object properties by reference rather than by value. This caused the observer to incorrectly detect differences and write stale data back to syncedData. Now uses `deepEquals` for proper value comparison.

## 0.5.10

### Patch Changes

- Type utils in collection options as specific type (e.g. ElectricCollectionUtils) instead of generic UtilsRecord. ([#940](https://github.com/TanStack/db/pull/940))

- Fix proxy to handle frozen objects correctly. Previously, creating a proxy for a frozen object (such as data from state management libraries that freeze their state) would throw a TypeError when attempting to modify properties via the proxy. The proxy now uses an unfrozen internal copy as the Proxy target, allowing modifications to be tracked correctly while preserving the immutability of the original object. ([#933](https://github.com/TanStack/db/pull/933))

  Also adds support for `Object.seal()` and `Object.preventExtensions()` on proxies, allowing these operations to work correctly on change-tracking proxies.

## 0.5.9

### Patch Changes

- Fix bulk insert not detecting duplicate keys within the same batch. Previously, when inserting multiple items with the same key in a single bulk insert operation, later items would silently overwrite earlier ones. Now, a `DuplicateKeyError` is thrown when duplicate keys are detected within the same batch. ([#929](https://github.com/TanStack/db/pull/929))

## 0.5.8

### Patch Changes

- Fix pagination with Date orderBy values when backend has higher precision than JavaScript's millisecond precision. When loading duplicate values during cursor-based pagination, Date values now use a 1ms range query (`gte`/`lt`) instead of exact equality (`eq`) to correctly match all rows that fall within the same millisecond, even if the backend (e.g., PostgreSQL) stores them with microsecond precision. ([#913](https://github.com/TanStack/db/pull/913))

- Fixed incorrect deduplication of limited queries with different where clauses. Previously, a query like `{where: searchFilter, limit: 10}` could be incorrectly deduplicated against a prior query `{where: undefined, limit: 10}`, causing search/filter results to only show cached data. Now, limited queries are only deduplicated when their where clauses are structurally equal. ([#914](https://github.com/TanStack/db/pull/914))

## 0.5.7

### Patch Changes

- Fix change tracking for array items accessed via iteration methods (find, forEach, for...of, etc.) ([#910](https://github.com/TanStack/db/pull/910))

  Previously, modifications to array items retrieved via iteration methods were not tracked by the change proxy because these methods returned raw array elements instead of proxied versions. This caused `getChanges()` to return an empty object, which in turn caused `createOptimisticAction`'s `mutationFn` to never be called when using patterns like:

  ```ts
  collection.update(id, (draft) => {
    const item = draft.items.find((x) => x.id === targetId)
    if (item) {
      item.value = newValue // This change was not tracked!
    }
  })
  ```

  The fix adds proxy handling for array iteration methods similar to how Map/Set iteration is already handled, ensuring that callbacks receive proxied elements and returned elements are properly proxied.

  Also refactors proxy.ts for improved readability by extracting helper functions and hoisting constants to module scope.

## 0.5.6

### Patch Changes

- Fix scheduler handling of lazy left-join/live-query dependencies: treat non-enqueued lazy deps as satisfied to avoid unresolved-dependency deadlocks, and block only when a dep actually has pending work. ([#898](https://github.com/TanStack/db/pull/898))

## 0.5.5

### Patch Changes

- Fix data loss on component remount by implementing reference counting for QueryObserver lifecycle ([#870](https://github.com/TanStack/db/pull/870))

  **What changed vs main:**

  Previously, when live query subscriptions unsubscribed, there was no tracking of which rows were still needed by other active queries. This caused data loss during remounts.

  This PR adds reference counting infrastructure to properly manage QueryObserver lifecycle:
  1. Pass same predicates to `unloadSubset` that were passed to `loadSubset`
  2. Use them to compute the queryKey (via `generateQueryKeyFromOptions`)
  3. Use existing machinery (`queryToRows` map) to find rows that query loaded
  4. Decrement the ref count
  5. GC rows where count reaches 0 (no longer referenced by any active query)

  **Impact:**
  - Navigation back to previously loaded pages shows cached data immediately
  - No unnecessary refetches during quick remounts (< gcTime)
  - Multiple live queries with identical predicates correctly share QueryObservers
  - Proper row-level cleanup when last subscriber leaves
  - TanStack Query's cache lifecycle (gcTime) is fully respected
  - No data leakage from in-flight requests when unsubscribing

## 0.5.4

### Patch Changes

- Fix progressive mode to use fetchSnapshot and atomic swap ([#852](https://github.com/TanStack/db/pull/852))

  Progressive mode was broken because `requestSnapshot()` injected snapshots into the stream in causally correct position, which didn't work properly with the `full` mode stream. This release fixes progressive mode by:

  **Core Changes:**
  - Use `fetchSnapshot()` during initial sync to fetch and apply snapshots immediately in sync transactions
  - Buffer all stream messages during initial sync (renamed flag to `isBufferingInitialSync`)
  - Perform atomic swap on first `up-to-date`: truncate snapshot data → apply buffered messages → mark ready
  - Track txids/snapshots only after atomic swap (enables correct optimistic transaction confirmation)

  **Test Infrastructure:**
  - Added `ELECTRIC_TEST_HOOKS` symbol for test control (hidden from public API)
  - Added `progressiveTestControl.releaseInitialSync()` to E2E test config for explicit transition control
  - Created comprehensive progressive mode E2E test suite (8 tests):
    - Explicit snapshot phase and atomic swap validation
    - Txid tracking behavior (Electric-only)
    - Multiple concurrent snapshots with deduplication
    - Incremental updates after swap
    - Predicate handling and resilience tests

  **Bug Fixes:**
  - Fixed type errors in test files
  - All 166 unit tests + 95 E2E tests passing

- Improved error messages when invalid source types are passed to `.from()` or `.join()` methods. When users mistakenly pass a string, null, array, or other invalid type instead of an object with a collection, they now receive a clear, actionable error message with an example of the correct usage (e.g., `.from({ todos: todosCollection })`). ([#875](https://github.com/TanStack/db/pull/875))

- Migrated paced mutations implementation from `@tanstack/pacer` to `@tanstack/pacer-lite`. The lite version provides the same core functionality with minimal overhead and no external dependencies, making it more suitable for library use. This is an internal implementation change with no impact on the public API - all paced mutation strategies (debounce, throttle, queue) continue to work exactly as before. ([#880](https://github.com/TanStack/db/pull/880))

- Add warning when calling `.preload()` on collections with `on-demand` syncMode. In on-demand mode, data is only loaded when queries request it, so calling `.preload()` on the collection itself is a no-op. Users should create a live query and call `.preload()` on that instead. ([#871](https://github.com/TanStack/db/pull/871))

## 0.5.3

### Patch Changes

- Pass all operators in where clauses to the collection's loadSubset function ([#851](https://github.com/TanStack/db/pull/851))

- Improve type of mutations in transactions ([#854](https://github.com/TanStack/db/pull/854))

## 0.5.2

### Patch Changes

- Fix localStorage collections to properly handle numeric and string IDs without collisions. Previously, operations could target the wrong item when using numeric IDs (e.g., `id: 1`, `id: 2`) after the page reloaded, due to a type mismatch between numeric keys in memory and stringified keys from localStorage. Keys are now encoded with type prefixes (`n:` for numbers, `s:` for strings) to prevent all possible collisions between different key types. ([#845](https://github.com/TanStack/db/pull/845))

## 0.5.1

### Patch Changes

- Upgrade @tanstack/pacer to v0.16.2 and fix AsyncQueuer API usage. The pacer package API changed significantly, requiring updates to how AsyncQueuer is constructed and items are queued in the queueStrategy implementation. ([#840](https://github.com/TanStack/db/pull/840))

## 0.5.0

### Minor Changes

- Implement 3-valued logic (true/false/unknown) for all comparison and logical operators. ([#765](https://github.com/TanStack/db/pull/765))
  Queries with null/undefined values now behave consistently with SQL databases, where UNKNOWN results exclude rows from WHERE clauses.

  **Breaking Change**: This changes the behavior of `WHERE` and `HAVING` clauses when dealing with `null` and `undefined` values.

  **Example 1: Equality checks with null**

  Previously, this query would return all persons with `age = null`:

  ```ts
  q.from(...).where(({ person }) => eq(person.age, null))
  ```

  With 3-valued logic, `eq(anything, null)` evaluates to `null` (UNKNOWN) and is filtered out. Use `isNull()` instead:

  ```ts
  q.from(...).where(({ person }) => isNull(person.age))
  ```

  **Example 2: Comparisons with null values**

  Previously, this query would return persons with `age < 18` OR `age = null`:

  ```ts
  q.from(...).where(({ person }) => lt(person.age, 18))
  ```

  With 3-valued logic, `lt(null, 18)` evaluates to `null` (UNKNOWN) and is filtered out. The same applies to `undefined` values. To include null values, combine with `isNull()`:

  ```ts
  q.from(...).where(({ person }) =>
    or(lt(person.age, 18), isNull(person.age))
  )
  ```

### Patch Changes

- Add optional compareOptions to collection configuration. ([#763](https://github.com/TanStack/db/pull/763))

- Add expression helper utilities for parsing LoadSubsetOptions in queryFn. ([#763](https://github.com/TanStack/db/pull/763))

  When using `syncMode: 'on-demand'`, TanStack DB now provides helper functions to easily parse where clauses, orderBy, and limit predicates into your API's format:
  - `parseWhereExpression`: Parse where clauses with custom handlers for each operator
  - `parseOrderByExpression`: Parse order by into simple array format
  - `extractSimpleComparisons`: Extract simple AND-ed filters
  - `parseLoadSubsetOptions`: Convenience function to parse all options at once
  - `walkExpression`, `extractFieldPath`, `extractValue`: Lower-level helpers

  **Example:**

  ```typescript
  import { parseLoadSubsetOptions } from '@tanstack/db'
  // or from "@tanstack/query-db-collection" (re-exported for convenience)

  queryFn: async (ctx) => {
    const { where, orderBy, limit } = ctx.meta.loadSubsetOptions

    const parsed = parseLoadSubsetOptions({ where, orderBy, limit })

    // Build API request from parsed filters
    const params = new URLSearchParams()
    parsed.filters.forEach(({ field, operator, value }) => {
      if (operator === 'eq') {
        params.set(field.join('.'), String(value))
      }
    })

    return fetch(`/api/products?${params}`).then((r) => r.json())
  }
  ```

  This eliminates the need to manually traverse expression AST trees when implementing predicate push-down.

- Fix Uint8Array/Buffer comparison to work by content instead of reference. This enables proper equality checks for binary IDs like ULIDs in WHERE clauses using the `eq` function. ([#779](https://github.com/TanStack/db/pull/779))

- Add predicate comparison and merging utilities (isWhereSubset, intersectWherePredicates, unionWherePredicates, and related functions) to support predicate push-down in collection sync operations, enabling efficient tracking of loaded data ranges and preventing redundant server requests. Includes performance optimizations for large primitive IN predicates and full support for Date objects in equality, range, and IN clause comparisons. ([#763](https://github.com/TanStack/db/pull/763))

- Add support for orderBy and limit in currentStateAsChanges function ([#763](https://github.com/TanStack/db/pull/763))

- Adds an onDeduplicate callback on the DeduplicatedLoadSubset class which is called when a loadSubset call is deduplicated ([#763](https://github.com/TanStack/db/pull/763))

- Updated dependencies [[`7aedf12`](https://github.com/TanStack/db/commit/7aedf12996a67ef64010bca0d78d51c919dd384f), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb)]:
  - @tanstack/db-ivm@0.1.13

## 0.4.20

### Patch Changes

- Fix type inference for findOne() when used with join operations ([#749](https://github.com/TanStack/db/pull/749))

  Previously, using `findOne()` with join operations (leftJoin, innerJoin, etc.) resulted in the query type being inferred as `never`, breaking TypeScript type checking:

  ```typescript
  const query = useLiveQuery(
    (q) =>
      q
        .from({ todo: todoCollection })
        .leftJoin({ todoOptions: todoOptionsCollection }, ...)
        .findOne() // Type became 'never'
  )
  ```

  **The Fix:**

  Fixed the `MergeContextWithJoinType` type definition to conditionally include the `singleResult` property only when it's explicitly `true`, avoiding type conflicts when `findOne()` is called after joins:

  ```typescript
  // Before (buggy):
  singleResult: TContext['singleResult'] extends true ? true : false

  // After (fixed):
  type PreserveSingleResultFlag<TFlag> = [TFlag] extends [true]
    ? { singleResult: true }
    : {}

  // Used as:
  } & PreserveSingleResultFlag<TContext['singleResult']>
  ```

  **Why This Works:**

  By using a conditional intersection that omits the property entirely when not needed, we avoid type conflicts. Intersecting `{} & { singleResult: true }` cleanly results in `{ singleResult: true }`, whereas the previous approach created conflicting property types resulting in `never`. The tuple wrapper (`[TFlag]`) ensures robust behavior even if the flag type becomes a union in the future.

  **Impact:**
  - ✅ `findOne()` now works correctly with all join types
  - ✅ Type inference works properly in `useLiveQuery` and other contexts
  - ✅ Both `findOne()` before and after joins work correctly
  - ✅ All tests pass with no breaking changes (8 new type tests added)

- Improve error messages for custom getKey with joined queries ([#717](https://github.com/TanStack/db/pull/717))

  Enhanced `DuplicateKeySyncError` to provide context-aware guidance when duplicate keys occur with custom `getKey` and joined queries.

  **The Issue:**

  When using custom `getKey` with joins, duplicate keys can occur if the join produces multiple rows with the same key value. This is valid for 1:1 relationships but problematic for 1:many relationships, and the previous error message didn't explain what went wrong or how to fix it.

  **What's New:**

  When a duplicate key error occurs in a live query collection that uses both custom `getKey` and joins, the error message now:
  - Explains that joined queries can produce multiple rows with the same key
  - Suggests using a composite key in your `getKey` function
  - Provides concrete examples of solutions
  - Helps distinguish between correctly structured 1:1 joins vs problematic 1:many joins

  **Example:**

  ```typescript
  // ✅ Valid - 1:1 relationship with unique keys
  const userProfiles = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ profile: profiles })
        .join({ user: users }, ({ profile, user }) =>
          eq(profile.userId, user.id),
        ),
    getKey: (profile) => profile.id, // Each profile has unique ID
  })
  ```

  ```typescript
  // ⚠️ Problematic - 1:many relationship with duplicate keys
  const userComments = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ user: users })
        .join({ comment: comments }, ({ user, comment }) =>
          eq(user.id, comment.userId),
        ),
    getKey: (item) => item.userId, // Multiple comments share same userId!
  })

  // Enhanced error message:
  // "Cannot insert document with key "user1" from sync because it already exists.
  // This collection uses a custom getKey with joined queries. Joined queries can
  // produce multiple rows with the same key when relationships are not 1:1.
  // Consider: (1) using a composite key in your getKey function (e.g., `${item.key1}-${item.key2}`),
  // (2) ensuring your join produces unique rows per key, or (3) removing the
  // custom getKey to use the default composite key behavior."
  ```

- Add QueryObserver state utilities and convert error utils to getters ([#742](https://github.com/TanStack/db/pull/742))

  Exposes TanStack Query's QueryObserver state through QueryCollectionUtils, providing visibility into sync status beyond just error states. Also converts existing error state utilities from methods to getters for consistency with TanStack DB/Query patterns.

  **Breaking Changes:**
  - `lastError()`, `isError()`, and `errorCount()` are now getters instead of methods
    - Before: `collection.utils.lastError()`
    - After: `collection.utils.lastError`

  **New Utilities:**
  - `isFetching` - Check if query is currently fetching (initial or background)
  - `isRefetching` - Check if query is refetching in background
  - `isLoading` - Check if query is loading for first time
  - `dataUpdatedAt` - Get timestamp of last successful data update
  - `fetchStatus` - Get current fetch status ('fetching' | 'paused' | 'idle')

  **Use Cases:**
  - Show loading indicators during background refetches
  - Implement "Last updated X minutes ago" UI patterns
  - Better understanding of query sync behavior

  **Example Usage:**

  ```ts
  const collection = queryCollectionOptions({
    // ... config
  })

  // Check sync status
  if (collection.utils.isFetching) {
    console.log('Syncing with server...')
  }

  if (collection.utils.isRefetching) {
    console.log('Background refresh in progress')
  }

  // Show last update time
  const lastUpdate = new Date(collection.utils.dataUpdatedAt)
  console.log(`Last synced: ${lastUpdate.toLocaleTimeString()}`)

  // Check error state (now using getters)
  if (collection.utils.isError) {
    console.error('Sync failed:', collection.utils.lastError)
    console.log(`Failed ${collection.utils.errorCount} times`)
  }
  ```

## 0.4.19

### Patch Changes

- Significantly improve localStorage collection performance during rapid mutations ([#760](https://github.com/TanStack/db/pull/760))

  Optimizes localStorage collections to eliminate redundant storage reads, providing dramatic performance improvements for use cases with rapid mutations (e.g., text input with live query rendering).

  **Performance Improvements:**
  - **67% reduction in localStorage I/O operations** - from 3 reads + 1 write per mutation down to just 1 write
  - Eliminated 2 JSON parse operations per mutation
  - Eliminated 1 full collection diff operation per mutation
  - Leverages in-memory cache (`lastKnownData`) instead of reading from storage on every mutation

  **What Changed:**
  1. **Mutation handlers** now use in-memory cache instead of loading from storage before mutations
  2. **Post-mutation sync** eliminated - no longer triggers redundant storage reads after local mutations
  3. **Manual transactions** (`acceptMutations`) optimized to use in-memory cache

  **Before:** Each mutation performed 3 I/O operations:
  - `loadFromStorage()` - read + JSON parse
  - Modify data
  - `saveToStorage()` - JSON stringify + write
  - `processStorageChanges()` - another read + parse + diff

  **After:** Each mutation performs 1 I/O operation:
  - Modify in-memory data ✨ No I/O!
  - `saveToStorage()` - JSON stringify + write

  **Safety:**
  - Cross-tab synchronization still works correctly via storage event listeners
  - All 50 tests pass including 8 new tests specifically for rapid mutations and edge cases
  - 92.3% code coverage on local-storage.ts
  - `lastKnownData` cache kept in sync with storage through initial load, mutations, and cross-tab events

  This optimization is particularly impactful for applications with:
  - Real-time text input with live query rendering
  - Frequent mutations to localStorage-backed collections
  - Multiple rapid sequential mutations

## 0.4.18

### Patch Changes

- Fix bug with orderBy that caused queries to skip duplicate values and/or stall on duplicate values. ([#713](https://github.com/TanStack/db/pull/713))

- Validate against duplicate collection aliases in subqueries. Prevents a bug where using the same alias for a collection in both parent and subquery causes empty results or incorrect aggregation values. Now throws a clear `DuplicateAliasInSubqueryError` when this pattern is detected, guiding users to rename the conflicting alias. ([#719](https://github.com/TanStack/db/pull/719))

## 0.4.17

### Patch Changes

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

## 0.4.16

### Patch Changes

- Enable auto-indexing for nested field paths ([#728](https://github.com/TanStack/db/pull/728))

  Previously, auto-indexes were only created for top-level fields. Queries filtering on nested fields like `vehicleDispatch.date` or `profile.score` were forced to perform full table scans, causing significant performance issues.

  Now, auto-indexes are automatically created for nested field paths of any depth when using `eq()`, `gt()`, `gte()`, `lt()`, `lte()`, or `in()` operations.

  **Performance Impact:**

  Before this fix, filtering on nested fields resulted in expensive full scans:
  - Query time: ~353ms for 39 executions (from issue #727)
  - "graph run" and "d2ts join" operations dominated execution time

  After this fix, nested field queries use indexes:
  - Query time: Sub-millisecond (typical indexed lookup)
  - Proper index utilization verified through query optimizer

  **Example:**

  ```typescript
  const collection = createCollection({
    getKey: (item) => item.id,
    autoIndex: 'eager', // default
    // ... sync config
  })

  // These now automatically create and use indexes:
  collection.subscribeChanges((items) => console.log(items), {
    whereExpression: eq(row.vehicleDispatch?.date, '2024-01-01'),
  })

  collection.subscribeChanges((items) => console.log(items), {
    whereExpression: gt(row.profile?.stats.rating, 4.5),
  })
  ```

  **Index Naming:**

  Auto-indexes for nested paths use the format `auto:field.path` to avoid naming conflicts:
  - `auto:status` for top-level field `status`
  - `auto:profile.score` for nested field `profile.score`
  - `auto:metadata.stats.views` for deeply nested field `metadata.stats.views`

  Fixes #727

- Fixed performance issue where using multiple `.where()` calls created multiple filter operators in the query pipeline. The optimizer now implements the missing final step (step 3) of combining remaining WHERE clauses into a single AND expression. This applies to both queries with and without joins: ([#732](https://github.com/TanStack/db/pull/732))
  - Queries without joins: Multiple WHERE clauses are now combined before compilation
  - Queries with joins: Remaining WHERE clauses after predicate pushdown are combined

  This reduces filter operators from N to 1, making chained `.where()` calls perform identically to using a single `.where()` with `and()`.

- Add paced mutations with pluggable timing strategies ([#704](https://github.com/TanStack/db/pull/704))

  Introduces a new paced mutations system that enables optimistic mutations with pluggable timing strategies. This provides fine-grained control over when and how mutations are persisted to the backend. Powered by [TanStack Pacer](https://github.com/TanStack/pacer).

  **Key Design:**
  - **Debounce/Throttle**: Only one pending transaction (collecting mutations) and one persisting transaction (writing to backend) at a time. Multiple rapid mutations automatically merge together.
  - **Queue**: Each mutation creates a separate transaction, guaranteed to run in the order they're made (FIFO by default, configurable to LIFO).

  **Core Features:**
  - **Pluggable Strategy System**: Choose from debounce, queue, or throttle strategies to control mutation timing
  - **Auto-merging Mutations**: Multiple rapid mutations on the same item automatically merge for efficiency (debounce/throttle only)
  - **Transaction Management**: Full transaction lifecycle tracking (pending → persisting → completed/failed)
  - **React Hook**: `usePacedMutations` for easy integration in React applications

  **Available Strategies:**
  - `debounceStrategy`: Wait for inactivity before persisting. Only final state is saved. (ideal for auto-save, search-as-you-type)
  - `queueStrategy`: Each mutation becomes a separate transaction, processed sequentially in order (defaults to FIFO, configurable to LIFO). All mutations are guaranteed to persist. (ideal for sequential workflows, rate-limited APIs)
  - `throttleStrategy`: Ensure minimum spacing between executions. Mutations between executions are merged. (ideal for analytics, progress updates)

  **Example Usage:**

  ```ts
  import { usePacedMutations, debounceStrategy } from '@tanstack/react-db'

  const mutate = usePacedMutations({
    mutationFn: async ({ transaction }) => {
      await api.save(transaction.mutations)
    },
    strategy: debounceStrategy({ wait: 500 }),
  })

  // Trigger a mutation
  const tx = mutate(() => {
    collection.update(id, (draft) => {
      draft.value = newValue
    })
  })

  // Optionally await persistence
  await tx.isPersisted.promise
  ```

## 0.4.15

### Patch Changes

- Added support for custom parsers/serializers like superjson in LocalStorage collections ([#730](https://github.com/TanStack/db/pull/730))

## 0.4.14

### Patch Changes

- Fix collection cleanup to fire status:change event with 'cleaned-up' status ([#714](https://github.com/TanStack/db/pull/714))

  Previously, when a collection was garbage collected, event handlers were removed before the status was changed to 'cleaned-up'. This prevented listeners from receiving the status:change event, breaking the collection factory pattern where collections listen for cleanup to remove themselves from a cache.

  Now, the cleanup process:
  1. Cleans up sync, state, changes, and indexes
  2. Sets status to 'cleaned-up' (fires the event)
  3. Finally cleans up event handlers

  This enables the collection factory pattern:

  ```typescript
  const cache = new Map<string, ReturnType<typeof createCollection>>()

  const getTodoCollection = (id: string) => {
    if (!cache.has(id)) {
      const collection = createCollection(/* ... */)

      collection.on('status:change', ({ status }) => {
        if (status === 'cleaned-up') {
          cache.delete(id) // This now works!
        }
      })

      cache.set(id, collection)
    }
    return cache.get(id)!
  }
  ```

## 0.4.13

### Patch Changes

- Fix synced propagation when preceding mutation was non-optimistic ([#715](https://github.com/TanStack/db/pull/715))

## 0.4.12

### Patch Changes

- Add in-memory fallback for localStorage collections in SSR environments ([#696](https://github.com/TanStack/db/pull/696))

  Prevents errors when localStorage collections are imported on the server by automatically falling back to an in-memory store. This allows isomorphic JavaScript applications to safely import localStorage collection modules without errors during module initialization.

  When localStorage is not available (e.g., in server-side rendering environments), the collection automatically uses an in-memory storage implementation. Data will not persist across page reloads or be shared across tabs when using the in-memory fallback, but the collection will function normally otherwise.

  Fixes #691

- Add support for orderBy and limit in currentStateAsChanges function ([#701](https://github.com/TanStack/db/pull/701))

- Updated dependencies [[`8187c6d`](https://github.com/TanStack/db/commit/8187c6d69c4b498e306ac2eb5fc7115e4f8193a5)]:
  - @tanstack/db-ivm@0.1.12

## 0.4.11

### Patch Changes

- Add support for pre-created live query collections in useLiveInfiniteQuery, enabling router loader patterns where live queries can be created, preloaded, and passed to components. ([#684](https://github.com/TanStack/db/pull/684))

## 0.4.10

### Patch Changes

- Add `utils.setWindow()` method to live query collections to dynamically change limit and offset on ordered queries. ([#663](https://github.com/TanStack/db/pull/663))

  You can now change the pagination window of an ordered live query without recreating the collection:

  ```ts
  const users = createLiveQueryCollection((q) =>
    q
      .from({ user: usersCollection })
      .orderBy(({ user }) => user.name, 'asc')
      .limit(10)
      .offset(0),
  )

  users.utils.setWindow({ offset: 10, limit: 10 })
  ```

- Added comprehensive loading state tracking and configurable sync modes to collections and live queries: ([#669](https://github.com/TanStack/db/pull/669))
  - Added `isLoadingSubset` property and `loadingSubset:change` events to all collections for tracking when data is being loaded
  - Added `syncMode` configuration option to collections:
    - `'eager'` (default): Loads all data immediately during initial sync
    - `'on-demand'`: Only loads data as requested via `loadSubset` calls
  - Added comprehensive status tracking to collection subscriptions with `status` property (`'ready'` | `'loadingSubset'`) and events (`status:change`, `status:ready`, `status:loadingSubset`, `unsubscribed`)
  - Live queries automatically reflect loading state from their source collection subscriptions, with each query maintaining isolated loading state to prevent status "bleed" between independent queries
  - Enhanced `setWindow` utility to return `Promise<void>` when loading is triggered, allowing callers to await data loading completion
  - Added `subscription` parameter to `loadSubset` handler for advanced sync implementations that need to track subscription lifecycle

- Updated dependencies [[`63aa8ef`](https://github.com/TanStack/db/commit/63aa8ef8b09960ce0f93e068d41b37fb0503a21a)]:
  - @tanstack/db-ivm@0.1.11

## 0.4.9

### Patch Changes

- Fix self-join bug by implementing per-alias subscriptions in live queries ([#625](https://github.com/TanStack/db/pull/625))

- Stop pushing where clauses that target renamed subquery projections so alias remapping stays intact, preventing a bug where a where clause would not be executed correctly. ([#654](https://github.com/TanStack/db/pull/654))

- Add a scheduler that ensures that if a transaction touches multiple collections that feed into a single live query, the live query only emits a single batch of updates. This fixes an issue where multiple renders could be triggered from a live query under this situation. ([#628](https://github.com/TanStack/db/pull/628))

- Updated dependencies [[`eeb05d4`](https://github.com/TanStack/db/commit/eeb05d449defbaaac584f4bb8febcb8946cfdf21)]:
  - @tanstack/db-ivm@0.1.10

## 0.4.8

### Patch Changes

- Fixed critical bug where optimistic mutations were lost when their async handlers completed during a truncate operation. The fix captures a snapshot of optimistic state when `truncate()` is called and restores it during commit, then overlays any still-active transactions to handle late-arriving mutations. This ensures client-side optimistic state is preserved through server-initiated must-refetch scenarios. ([#659](https://github.com/TanStack/db/pull/659))

- Refactored live queries to execute eagerly during sync. Live queries now materialize their results immediately as data arrives from source collections, even while those collections are still in a "loading" state, rather than waiting for all sources to be "ready" before executing. ([#658](https://github.com/TanStack/db/pull/658))

## 0.4.7

### Patch Changes

- Add acceptMutations utility for local collections in manual transactions. Local-only and local-storage collections now expose `utils.acceptMutations(transaction, collection)` that must be called in manual transaction `mutationFn` to persist mutations. ([#638](https://github.com/TanStack/db/pull/638))

## 0.4.6

### Patch Changes

- Push predicates down to sync layer ([#617](https://github.com/TanStack/db/pull/617))

- prefix logs and errors with collection id, when available ([#655](https://github.com/TanStack/db/pull/655))

## 0.4.5

### Patch Changes

- Fixed race condition which could result in a live query throwing and becoming stuck after multiple mutations complete asynchronously. ([#650](https://github.com/TanStack/db/pull/650))

## 0.4.4

### Patch Changes

- Fix live queries getting stuck during long-running sync commits by always ([#631](https://github.com/TanStack/db/pull/631))
  clearing the batching flag on forced emits, tolerating duplicate insert echoes,
  and allowing optimistic recomputes to run while commits are still applying. Adds
  regression coverage for concurrent optimistic inserts, queued updates, and the
  offline-transactions example to ensure everything stays in sync.

- Fixed bug where orderBy would fail when a collection alias had the same name as one of its schema fields. For example, .from({ email: emailCollection }).orderBy(({ email }) => email.createdAt) now works correctly even when the collection has an email field in its schema. ([#637](https://github.com/TanStack/db/pull/637))

- Optimization: reverse the index when the direction does not match. ([#627](https://github.com/TanStack/db/pull/627))

- Fixed a bug that could result in a duplicate delete event for a row ([#621](https://github.com/TanStack/db/pull/621))

- Fix bug where optimized queries would use the wrong index because the index is on the right column but was built using different comparison options (e.g. different direction, string sort, or null ordering). ([#623](https://github.com/TanStack/db/pull/623))

## 0.4.3

### Patch Changes

- Remove circular imports to fix compatibility with Metro bundler ([#605](https://github.com/TanStack/db/pull/605))

## 0.4.2

### Patch Changes

- Add support for Date objects to min/max aggregates and range queries when using an index. ([#428](https://github.com/TanStack/db/pull/428))

- Prevent pushing down of where clauses that only touch the namespace of a source, rather than a prop on that namespace. This ensures that the semantics of the query are maintained for things such as `isUndefined(namespace)` after a join. ([#600](https://github.com/TanStack/db/pull/600))

- Fix joins using conditions with computed values (such as `concat()`) ([#595](https://github.com/TanStack/db/pull/595))

- Fix repeated renders when markReady called when the collection was already ready. This would occur after each long poll on an Electric collection. ([#604](https://github.com/TanStack/db/pull/604))

- Updated dependencies [[`51c6bc5`](https://github.com/TanStack/db/commit/51c6bc58244ed6a3ac853e7e6af7775b33d6b65a)]:
  - @tanstack/db-ivm@0.1.9

## 0.4.1

### Patch Changes

- Implement idle cleanup for collection garbage collection ([#590](https://github.com/TanStack/db/pull/590))

  Collection cleanup operations now use `requestIdleCallback()` to prevent blocking the UI thread during garbage collection. This improvement ensures better performance by scheduling cleanup during browser idle time rather than immediately when collections have no active subscribers.

  **Key improvements:**
  - Non-blocking cleanup operations that don't interfere with user interactions
  - Automatic fallback to `setTimeout` for older browsers without `requestIdleCallback` support
  - Proper callback management to prevent race conditions during cleanup rescheduling
  - Maintains full backward compatibility with existing collection lifecycle behavior

  This addresses performance concerns where collection cleanup could cause UI thread blocking during active application usage.

## 0.4.0

### Minor Changes

- Let collection.subscribeChanges return a subscription object. Move all data loading code related to optimizations into that subscription object. ([#564](https://github.com/TanStack/db/pull/564))

### Patch Changes

- optimise the live query graph execution by removing recursive calls to graph.run ([#564](https://github.com/TanStack/db/pull/564))

- Refactor the main Collection class into smaller classes to make it easier to maintain. ([#560](https://github.com/TanStack/db/pull/560))

- Updated dependencies [[`2f87216`](https://github.com/TanStack/db/commit/2f8721630e06331ca8bb2f962fbb283341103a58), [`89b1c41`](https://github.com/TanStack/db/commit/89b1c414937b021186cf128300d279d1cb4f51fe)]:
  - @tanstack/db-ivm@0.1.8

## 0.3.2

### Patch Changes

- Added a new events system for subscribing to status changes and other internal events. ([#555](https://github.com/TanStack/db/pull/555))

## 0.3.1

### Patch Changes

- Fix `stateWhenReady()` and `toArrayWhenReady()` methods to consistently wait for collections to be ready by using `preload()` internally. This ensures the collection starts loading if needed rather than just waiting passively. ([#565](https://github.com/TanStack/db/pull/565))

## 0.3.0

### Minor Changes

- Fix transaction error handling to match documented behavior and preserve error identity ([#558](https://github.com/TanStack/db/pull/558))

  ### Breaking Changes
  - `commit()` now throws errors when the mutation function fails (previously returned a failed transaction)

  ### Bug Fixes
  1. **Fixed commit() not throwing errors** - The `commit()` method now properly throws errors when the mutation function fails, matching the documented behavior. Both `await tx.commit()` and `await tx.isPersisted.promise` now work correctly in try/catch blocks.

  ### Migration Guide

  If you were catching errors from `commit()` by checking the transaction state:

  ```js
  // Before - commit() didn't throw
  await tx.commit()
  if (tx.state === 'failed') {
    console.error('Failed:', tx.error)
  }

  // After - commit() now throws
  try {
    await tx.commit()
  } catch (error) {
    console.error('Failed:', error)
  }
  ```

### Patch Changes

- Improve mutation merging from crude replacement to sophisticated merge logic ([#557](https://github.com/TanStack/db/pull/557))

  Previously, mutations were simply replaced when operating on the same item. Now mutations are intelligently merged based on their operation types (insert vs update vs delete), reducing network overhead and better preserving user intent.

## 0.2.5

### Patch Changes

- Refactor of the types of collection config factories for better type inference. ([#530](https://github.com/TanStack/db/pull/530))

- Define BaseCollectionConfig interface and let all collections extend it. ([#531](https://github.com/TanStack/db/pull/531))

- Updated dependencies [[`c58cec9`](https://github.com/TanStack/db/commit/c58cec9eb3f5fc72453793cfd6842387621a63d3)]:
  - @tanstack/db-ivm@0.1.7

## 0.2.4

### Patch Changes

- optimise key loading into query graph ([#526](https://github.com/TanStack/db/pull/526))

- Fix a bug where selecting a prop that used a built in object such as a Date would result in incorrect types in the result object. ([#524](https://github.com/TanStack/db/pull/524))

- Updated dependencies [[`92febbf`](https://github.com/TanStack/db/commit/92febbf1feaa1d46f8cc4d7a4ea0d44cd5f85256)]:
  - @tanstack/db-ivm@0.1.6

## 0.2.3

### Patch Changes

- Fixed a bug where a live query could get stuck in "loading" state, or show incomplete data, when an electric "must-refetch" message arrived before the first "up-to-date". ([#532](https://github.com/TanStack/db/pull/532))

- Updated dependencies [[`a9878ad`](https://github.com/TanStack/db/commit/a9878ad58b71c3a2d10c03d75179a793bccf4ffc)]:
  - @tanstack/db-ivm@0.1.5

## 0.2.2

### Patch Changes

- fix a bug where a live query with a custom getKey would not update correctly because the source key was being used instead of the custom key for presence checks. ([#521](https://github.com/TanStack/db/pull/521))

- Updated dependencies [[`c11eb51`](https://github.com/TanStack/db/commit/c11eb51fe24bb1c4c8529bcd34467af4e6542c71)]:
  - @tanstack/db-ivm@0.1.4

## 0.2.1

### Patch Changes

- export the new `isUndefined` and `isNull` query builder functions ([#515](https://github.com/TanStack/db/pull/515))

## 0.2.0

### Minor Changes

- ## Enhanced Ref System with Nested Optional Properties ([#386](https://github.com/TanStack/db/pull/386))

  Comprehensive refactor of the ref system to properly support nested structures and optionality, aligning the type system with JavaScript's optional chaining behavior.

  ### ✨ New Features
  - **Nested Optional Properties**: Full support for deeply nested optional objects (`employees.profile?.bio`, `orders.customer?.address?.street`)
  - **Enhanced Type Safety**: Optional types now correctly typed as `RefProxy<T> | undefined` with optionality outside the ref
  - **New Query Functions**: Added `isUndefined`, `isNull` for proper null/undefined checks
  - **Improved JOIN Handling**: Fixed optionality in JOIN operations and multiple GROUP BY support

  ### ⚠️ Breaking Changes

  **IMPORTANT**: Code that previously ignored optionality now requires proper optional chaining syntax.

  ```typescript
  // Before (worked but type-unsafe)
  employees.profile.bio // ❌ Now throws type error

  // After (correct and type-safe)
  employees.profile?.bio // ✅ Required syntax
  ```

  ### Migration

  Add `?.` when accessing potentially undefined nested properties

### Patch Changes

- fix count aggregate function (evaluate only not null field values like SQL count) ([#453](https://github.com/TanStack/db/pull/453))

- fix a bug where distinct was not applied to queries using a join ([#510](https://github.com/TanStack/db/pull/510))

- Fix bug where too much data would be loaded when the lazy collection of a join contains an offset and/or limit clause. ([#508](https://github.com/TanStack/db/pull/508))

- Refactored `select` improving spread (`...obj`) support and enabling nested projection. ([#389](https://github.com/TanStack/db/pull/389))

- fix a bug that prevented chaining joins (joining collectionB to collectionA, then collectionC to collectionB) within one query without using a subquery ([#511](https://github.com/TanStack/db/pull/511))

- Updated dependencies [[`08303e6`](https://github.com/TanStack/db/commit/08303e645974db97e10b2aca0031abcbce027dd6), [`0f6fb37`](https://github.com/TanStack/db/commit/0f6fb373d56177282552be5fb61e5bb32aeb09bb), [`0be4e2c`](https://github.com/TanStack/db/commit/0be4e2cf2b57a5e204f43c04457ddacc3532bd08)]:
  - @tanstack/db-ivm@0.1.3

## 0.1.12

### Patch Changes

- Fixes a bug where optimized joins would miss data ([#501](https://github.com/TanStack/db/pull/501))

## 0.1.11

### Patch Changes

- fix: improve InvalidSourceError message clarity ([#488](https://github.com/TanStack/db/pull/488))

  The InvalidSourceError now provides a clear, actionable error message that:
  - Explicitly states the problem is passing a non-Collection/non-subquery to a live query
  - Includes the alias name to help identify which source is problematic
  - Provides guidance on what should be passed instead (Collection instances or QueryBuilder subqueries)

  This replaces the generic "Invalid source" message with helpful debugging information.

## 0.1.10

### Patch Changes

- Fixed an optimization bug where orderBy clauses using a single-column array were not recognized as optimizable. Queries that order by a single column are now correctly optimized even when specified as an array. ([#477](https://github.com/TanStack/db/pull/477))

- fix an bug where a live query that used joins could become stuck empty when its remounted/resubscribed ([#484](https://github.com/TanStack/db/pull/484))

- fixed a bug where a pending sync transaction could be applied early when an optimistic mutation was resolved or rolled back ([#482](https://github.com/TanStack/db/pull/482))

- Add support for queries to order results based on aggregated values ([#481](https://github.com/TanStack/db/pull/481))

## 0.1.9

### Patch Changes

- Fix handling of Temporal objects in proxy's deepClone and deepEqual functions ([#434](https://github.com/TanStack/db/pull/434))
  - Temporal objects (like Temporal.ZonedDateTime) are now properly preserved during cloning instead of being converted to empty objects
  - Added detection for all Temporal API object types via Symbol.toStringTag
  - Temporal objects are returned directly from deepClone since they're immutable
  - Added proper equality checking for Temporal objects using their built-in equals() method
  - Prevents unnecessary proxy creation for immutable Temporal objects

## 0.1.8

### Patch Changes

- Fix bug that caused initial query results to have too few rows when query has orderBy, limit, and where clauses. ([#461](https://github.com/TanStack/db/pull/461))

- fix disabling of gc by setting `gcTime: 0` on the collection options ([#463](https://github.com/TanStack/db/pull/463))

- docs: electric-collection reference page ([#429](https://github.com/TanStack/db/pull/429))

## 0.1.7

### Patch Changes

- fix a race condition that could result in the initial state of a joined collection being sent to the live query pipeline twice, this would result in incorrect join results. ([#451](https://github.com/TanStack/db/pull/451))

- Refactor live query collection ([#432](https://github.com/TanStack/db/pull/432))

- Fix infinite loop bug with queries that use orderBy clause with a limit ([#450](https://github.com/TanStack/db/pull/450))

- mark item drafts as a `mutable` type ([#408](https://github.com/TanStack/db/pull/408))

- Fix query optimizer to preserve outer join semantics by keeping residual WHERE clauses when pushing predicates to subqueries. ([#442](https://github.com/TanStack/db/pull/442))

## 0.1.6

### Patch Changes

- fix for a performance regression when syncing large collections due to a look up of previously deleted keys ([#430](https://github.com/TanStack/db/pull/430))

## 0.1.5

### Patch Changes

- Ensure that a new d2 graph is used for live queries that are cleaned up by the gc process. Fixes the "Graph already finalized" error. ([#419](https://github.com/TanStack/db/pull/419))

## 0.1.4

### Patch Changes

- Ensure that the ready status is correctly returned from a live query ([#390](https://github.com/TanStack/db/pull/390))

- Optimize order by to lazily load ordered data if a range index is available on the field that is being ordered on. ([#410](https://github.com/TanStack/db/pull/410))

- Add a new truncate method to the sync handler to enable a collections state to be reset from a sync transaction. ([#412](https://github.com/TanStack/db/pull/412))

- Ensure LiveQueryCollections are properly transitioning to ready state when source collections are preloaded after creation of the live query collection ([#395](https://github.com/TanStack/db/pull/395))

- Optimize joins to use index on the join key when available. ([#335](https://github.com/TanStack/db/pull/335))

- Updated dependencies [[`6c1c19c`](https://github.com/TanStack/db/commit/6c1c19cedbc1d9d98396948e8e43fa0515bb8919), [`68538b4`](https://github.com/TanStack/db/commit/68538b4c446abeb992e24964f811c8900749f141)]:
  - @tanstack/db-ivm@0.1.2

## 0.1.3

### Patch Changes

- Fix bug with orderBy that resulted in query results having less rows than the configured limit. ([#405](https://github.com/TanStack/db/pull/405))

- Updated dependencies [[`0cb7699`](https://github.com/TanStack/db/commit/0cb76999e5d6df5916694a5afeb31b928eab68e4)]:
  - @tanstack/db-ivm@0.1.1

## 0.1.2

### Patch Changes

- Ensure that you can use optional properties in the `select` and `join` clauses of a query, and fix an issue where standard schemas were not properly carried through to live queries. ([#377](https://github.com/TanStack/db/pull/377))

- Add option to configure how orderBy compares values. This includes ascending/descending order, ordering of null values, and lexical vs locale comparison for strings. ([#314](https://github.com/TanStack/db/pull/314))

## 0.1.1

### Patch Changes

- Cleanup transactions after they complete to prevent memory leak and performance degradation ([#371](https://github.com/TanStack/db/pull/371))

- Fix the types on `localOnlyCollectionOptions` and `localStorageCollectionOptions` so that they correctly infer the types from a passed in schema ([#372](https://github.com/TanStack/db/pull/372))

## 0.1.0

### Minor Changes

- 0.1 release - first beta 🎉 ([#332](https://github.com/TanStack/db/pull/332))

### Patch Changes

- We have moved development of the differential dataflow implementation from @electric-sql/d2mini to a new @tanstack/db-ivm package inside the tanstack db monorepo to make development simpler. ([#330](https://github.com/TanStack/db/pull/330))

- Updated dependencies [[`7d2f4be`](https://github.com/TanStack/db/commit/7d2f4be95c43aad29fb61e80e5a04c58c859322b), [`f0eda36`](https://github.com/TanStack/db/commit/f0eda36cb36350399bc8835686a6c4b6ad297e45)]:
  - @tanstack/db-ivm@0.1.0

## 0.0.33

### Patch Changes

- bump d2mini to latest which has a significant speedup ([#321](https://github.com/TanStack/db/pull/321))

## 0.0.32

### Patch Changes

- Fix LiveQueryCollection hanging when source collections have no data ([#309](https://github.com/TanStack/db/pull/309))

  Fixed an issue where `LiveQueryCollection.preload()` would hang indefinitely when source collections call `markReady()` without data changes (e.g., when queryFn returns empty array).

  The fix implements a proper event-based solution:
  - Collections now emit empty change events when becoming ready with no data
  - WHERE clause filtered subscriptions now correctly pass through empty ready signals
  - Both regular and WHERE clause optimized LiveQueryCollections now work correctly with empty source collections

## 0.0.31

### Patch Changes

- Fix UI responsiveness issue with rapid user interactions in collections ([#308](https://github.com/TanStack/db/pull/308))

  Fixed a critical issue where rapid user interactions (like clicking multiple checkboxes quickly) would cause the UI to become unresponsive when using collections with slow backend responses. The problem occurred when optimistic updates would back up and the UI would stop reflecting user actions.

  **Root Causes:**
  - Event filtering logic was blocking ALL events for keys with recent sync operations, including user-initiated actions
  - Event batching was queuing user actions instead of immediately updating the UI during high-frequency operations

  **Solution:**
  - Added `triggeredByUserAction` parameter to `recomputeOptimisticState()` to distinguish user actions from sync operations
  - Modified event filtering to allow user-initiated actions to bypass sync status checks
  - Enhanced `emitEvents()` with `forceEmit` parameter to skip batching for immediate user action feedback
  - Updated all user action code paths to properly identify themselves as user-triggered

  This ensures the UI remains responsive during rapid user interactions while maintaining the performance benefits of event batching and duplicate event filtering for sync operations.

## 0.0.30

### Patch Changes

- Remove OrderedIndex in favor of more efficient BTree index. ([#302](https://github.com/TanStack/db/pull/302))

## 0.0.29

### Patch Changes

- Automatically restart collections from cleaned-up state when operations are called ([#285](https://github.com/TanStack/db/pull/285))

  Collections in a `cleaned-up` state now automatically restart when operations like `insert()`, `update()`, or `delete()` are called on them. This matches the behavior of other collection access patterns and provides a better developer experience by avoiding unnecessary errors.

- Add collection index system for optimized queries and subscriptions ([#257](https://github.com/TanStack/db/pull/257))

  This release introduces a comprehensive index system for collections that enables fast lookups and query optimization:

- Enabled live queries to use the collection indexes ([#258](https://github.com/TanStack/db/pull/258))

  Live queries now use the collection indexes for many queries, using the optimized query pipeline to push where clauses to the collection, which is then able to use the index to filter the data.

- Added an auto-indexing system that creates indexes on collection eagerly when querying, this is a performance optimization that can be disabled by setting the autoIndex option to `off`. ([#292](https://github.com/TanStack/db/pull/292))

- feat: Replace string-based errors with named error classes for better error handling ([#297](https://github.com/TanStack/db/pull/297))

  This comprehensive update replaces all string-based error throws throughout the TanStack DB codebase with named error classes, providing better type safety and developer experience.

  ## New Features
  - **Root `TanStackDBError` class** - all errors inherit from a common base for unified error handling
  - **Named error classes** organized by package and functional area
  - **Type-safe error handling** using `instanceof` checks instead of string matching
  - **Package-specific error definitions** - each adapter has its own error classes
  - **Better IDE support** with autocomplete for error types

  ## Package Structure

  ### Core Package (`@tanstack/db`)

  Contains generic errors used across the ecosystem:
  - Collection configuration, state, and operation errors
  - Transaction lifecycle and mutation errors
  - Query building, compilation, and execution errors
  - Storage and serialization errors

  ### Adapter Packages

  Each adapter now exports its own specific error classes:
  - **`@tanstack/electric-db-collection`**: Electric-specific errors
  - **`@tanstack/trailbase-db-collection`**: TrailBase-specific errors
  - **`@tanstack/query-db-collection`**: Query collection specific errors

  ## Breaking Changes
  - Error handling code using string matching will need to be updated to use `instanceof` checks
  - Some error messages may have slight formatting changes
  - Adapter-specific errors now need to be imported from their respective packages

  ## Migration Guide

  ### Core DB Errors

  **Before:**

  ```ts
  try {
    collection.insert(data)
  } catch (error) {
    if (error.message.includes('already exists')) {
      // Handle duplicate key error
    }
  }
  ```

  **After:**

  ```ts
  import { DuplicateKeyError } from '@tanstack/db'

  try {
    collection.insert(data)
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      // Type-safe error handling
    }
  }
  ```

  ### Adapter-Specific Errors

  **Before:**

  ```ts
  // Electric collection errors were imported from @tanstack/db
  import { ElectricInsertHandlerMustReturnTxIdError } from '@tanstack/db'
  ```

  **After:**

  ```ts
  // Now import from the specific adapter package
  import { ElectricInsertHandlerMustReturnTxIdError } from '@tanstack/electric-db-collection'
  ```

  ### Unified Error Handling

  **New:**

  ```ts
  import { TanStackDBError } from '@tanstack/db'

  try {
    // Any TanStack DB operation
  } catch (error) {
    if (error instanceof TanStackDBError) {
      // Handle all TanStack DB errors uniformly
      console.log('TanStack DB error:', error.message)
    }
  }
  ```

  ## Benefits
  - **Type Safety**: All errors now have specific types that can be caught with `instanceof`
  - **Unified Error Handling**: Root `TanStackDBError` class allows catching all library errors with a single check
  - **Better Package Separation**: Each adapter manages its own error types
  - **Developer Experience**: Better IDE support with autocomplete for error types
  - **Maintainability**: Error definitions are co-located with their usage
  - **Consistency**: Uniform error handling patterns across the entire codebase

  All error classes maintain the same error messages and behavior while providing better structure and package separation.

## 0.0.28

### Patch Changes

- fixed an issue with joins where a specific order of references in the `eq()` expression was required, and added additional validation ([#291](https://github.com/TanStack/db/pull/291))

- Add comprehensive documentation for creating collection options creators ([#284](https://github.com/TanStack/db/pull/284))

  This adds a new documentation page `collection-options-creator.md` that provides detailed guidance for developers building collection options creators. The documentation covers:
  - Core requirements and configuration interfaces
  - Sync implementation patterns with transaction lifecycle (begin, write, commit, markReady)
  - Data parsing and type conversion using field-specific conversions
  - Two distinct mutation handler patterns:
    - Pattern A: User-provided handlers (ElectricSQL, Query style)
    - Pattern B: Built-in handlers (Trailbase, WebSocket style)
  - Complete WebSocket collection example with full round-trip flow
  - Managing optimistic state with various strategies (transaction IDs, ID-based tracking, refetch, timestamps)
  - Best practices for deduplication, error handling, and testing
  - Row update modes and advanced configuration options

  The documentation helps developers understand when to create custom collections versus using the query collection, and provides practical examples following the established patterns from existing collection implementations.

## 0.0.27

### Patch Changes

- fix arktype schemas for collections ([#279](https://github.com/TanStack/db/pull/279))

## 0.0.26

### Patch Changes

- Add initial release of TrailBase collection for TanStack DB. TrailBase is a blazingly fast, open-source alternative to Firebase built on Rust, SQLite, and V8. It provides type-safe REST and realtime APIs with sub-millisecond latencies, integrated authentication, and flexible access control - all in a single executable. This collection type enables seamless integration with TrailBase backends for high-performance real-time applications. ([#228](https://github.com/TanStack/db/pull/228))

## 0.0.25

### Patch Changes

- Fix iterator-based change tracking in proxy system ([#271](https://github.com/TanStack/db/pull/271))

  This fixes several issues with iterator-based change tracking for Maps and Sets:
  - **Map.entries()** now correctly updates actual Map entries instead of creating duplicate keys
  - **Map.values()** now tracks back to original Map keys using value-to-key mapping instead of using symbol placeholders
  - **Set iterators** now properly replace objects in Set when modified instead of creating symbol-keyed entries
  - **forEach()** methods continue to work correctly

  The implementation now uses a sophisticated parent-child tracking system with specialized `updateMap` and `updateSet` functions to ensure that changes made to objects accessed through iterators are properly attributed to the correct collection entries.

  This brings the proxy system in line with how mature libraries like Immer handle iterator-based change tracking, using method interception rather than trying to proxy all property access.

- Add explicit collection readiness detection with `isReady()` and `markReady()` ([#270](https://github.com/TanStack/db/pull/270))
  - Add `isReady()` method to check if a collection is ready for use
  - Add `onFirstReady()` method to register callbacks for when collection becomes ready
  - Add `markReady()` to SyncConfig interface for sync implementations to explicitly signal readiness
  - Replace `onFirstCommit()` with `onFirstReady()` for better semantics
  - Update status state machine to allow `loading` → `ready` transition for cases with no data to commit
  - Update all sync implementations (Electric, Query, Local-only, Local-storage) to use `markReady()`
  - Improve error handling by allowing collections to be marked ready even when sync errors occur

  This provides a more intuitive and ergonomic API for determining collection readiness, replacing the previous approach of using commits as a readiness signal.

## 0.0.24

### Patch Changes

- Add query optimizer with predicate pushdown ([#256](https://github.com/TanStack/db/pull/256))

  Implements automatic query optimization that moves WHERE clauses closer to data sources, reducing intermediate result sizes and improving performance for queries with joins.

- Add `leftJoin`, `rightJoin`, `innerJoin` and `fullJoin` aliases of the main `join` method on the query builder. ([#269](https://github.com/TanStack/db/pull/269))

- • Add proper tracking for array mutating methods (push, pop, shift, unshift, splice, sort, reverse, fill, copyWithin) ([#267](https://github.com/TanStack/db/pull/267))
  • Fix existing array tests that were misleadingly named but didn't actually call the methods they claimed to test
  • Add comprehensive test coverage for all supported array mutating methods

## 0.0.23

### Patch Changes

- Ensure schemas can apply defaults when inserting ([#209](https://github.com/TanStack/db/pull/209))

## 0.0.22

### Patch Changes

- New distinct operator for queries. ([#244](https://github.com/TanStack/db/pull/244))

## 0.0.21

### Patch Changes

- Move Collections to their own packages ([#252](https://github.com/TanStack/db/pull/252))
  - Move local-only and local-storage collections to main `@tanstack/db` package
  - Create new `@tanstack/electric-db-collection` package for ElectricSQL integration
  - Create new `@tanstack/query-db-collection` package for TanStack Query integration
  - Delete `@tanstack/db-collections` package (removed from repo)
  - Update example app and documentation to use new package structure

  Why?
  - Better separation of concerns
  - Independent versioning for each collection type
  - Cleaner dependencies (electric collections don't need query deps, etc.)
  - Easier to add more collection types moving forward

## 0.0.20

### Patch Changes

- Add non-optimistic mutations support ([#250](https://github.com/TanStack/db/pull/250))
  - Add `optimistic` option to insert, update, and delete operations
  - Default `optimistic: true` maintains backward compatibility
  - When `optimistic: false`, mutations only apply after server confirmation
  - Enables better control for server-validated operations and confirmation workflows

## 0.0.19

### Patch Changes

- - [Breaking change for the Electric Collection]: Use numbers for txid ([#245](https://github.com/TanStack/db/pull/245))
  - misc type fixes

## 0.0.18

### Patch Changes

- Improve jsdocs ([#243](https://github.com/TanStack/db/pull/243))

## 0.0.17

### Patch Changes

- Upgrade d2mini to 0.1.6 ([#239](https://github.com/TanStack/db/pull/239))

## 0.0.16

### Patch Changes

- add support for composable queries ([#232](https://github.com/TanStack/db/pull/232))

## 0.0.15

### Patch Changes

- add a sequence number to transactions to when sorting we can ensure that those created in the same ms are sorted in the correct order ([#230](https://github.com/TanStack/db/pull/230))

- Ensure that all transactions are given an id, fixes a potential bug with direct mutations ([#230](https://github.com/TanStack/db/pull/230))

## 0.0.14

### Patch Changes

- fixed the types on the onInsert/Update/Delete transactions ([#218](https://github.com/TanStack/db/pull/218))

## 0.0.13

### Patch Changes

- feat: implement Collection Lifecycle Management ([#198](https://github.com/TanStack/db/pull/198))

  Adds automatic lifecycle management for collections to optimize resource usage.

  **New Features:**
  - Added `startSync` option (defaults to `false`, set to `true` to start syncing immediately)
  - Automatic garbage collection after `gcTime` (default 5 minutes) of inactivity
  - Collection status tracking: "idle" | "loading" | "ready" | "error" | "cleaned-up"
  - Manual `preload()` and `cleanup()` methods for lifecycle control

  **Usage:**

  ```typescript
  const collection = createCollection({
    startSync: false, // Enable lazy loading
    gcTime: 300000, // Cleanup timeout (default: 5 minutes)
  })

  console.log(collection.status) // Current state
  await collection.preload() // Ensure ready
  await collection.cleanup() // Manual cleanup
  ```

- Refactored the way we compute change events over the synced state and the optimistic changes. This fixes a couple of issues where the change events were not being emitted correctly. ([#206](https://github.com/TanStack/db/pull/206))

- Add createOptimisticAction helper that replaces useOptimisticMutation ([#210](https://github.com/TanStack/db/pull/210))

  An example of converting a `useOptimisticMutation` hook to `createOptimisticAction`. Now all optimistic & server mutation logic are consolidated.

  ```diff
  -import { useOptimisticMutation } from '@tanstack/react-db'
  +import { createOptimisticAction } from '@tanstack/react-db'
  +
  +// Create the `addTodo` action, passing in your `mutationFn` and `onMutate`.
  +const addTodo = createOptimisticAction<string>({
  +  onMutate: (text) => {
  +    // Instantly applies the local optimistic state.
  +    todoCollection.insert({
  +      id: uuid(),
  +      text,
  +      completed: false
  +    })
  +  },
  +  mutationFn: async (text) => {
  +    // Persist the todo to your backend
  +    const response = await fetch('/api/todos', {
  +      method: 'POST',
  +      body: JSON.stringify({ text, completed: false }),
  +    })
  +    return response.json()
  +  }
  +})

   const Todo = () => {
  -  // Create the `addTodo` mutator, passing in your `mutationFn`.
  -  const addTodo = useOptimisticMutation({ mutationFn })
  -
     const handleClick = () => {
  -    // Triggers the mutationFn
  -    addTodo.mutate(() =>
  -      // Instantly applies the local optimistic state.
  -      todoCollection.insert({
  -        id: uuid(),
  -        text: '🔥 Make app faster',
  -        completed: false
  -      })
  -    )
  +    // Triggers the onMutate and then the mutationFn
  +    addTodo('🔥 Make app faster')
     }

     return <Button onClick={ handleClick } />
   }
  ```

## 0.0.12

### Patch Changes

- If a schema is passed, use that for the collection type. ([#186](https://github.com/TanStack/db/pull/186))

  You now must either pass an explicit type or schema - passing both will conflict.

## 0.0.11

### Patch Changes

- change the query engine to use d2mini, and simplified version of the d2ts differential dataflow library ([#175](https://github.com/TanStack/db/pull/175))

- Export `ElectricCollectionUtils` & allow passing generic to `createTransaction` ([#179](https://github.com/TanStack/db/pull/179))

## 0.0.10

### Patch Changes

- If collection.update is called and nothing is changed, return a transaction instead of throwing ([#174](https://github.com/TanStack/db/pull/174))

## 0.0.9

### Patch Changes

- Allow arrays in type of RHS in where clause when using set membership operators ([#149](https://github.com/TanStack/db/pull/149))

## 0.0.8

### Patch Changes

- Type PendingMutation whenever possible ([#163](https://github.com/TanStack/db/pull/163))

- refactor the live query comparator and fix an issue with sorting with a null/undefined value in a column of non-null values ([#167](https://github.com/TanStack/db/pull/167))

- A large refactor of the core `Collection` with: ([#155](https://github.com/TanStack/db/pull/155))
  - a change to not use Store internally and emit fine grade changes with `subscribeChanges` and `subscribeKeyChanges` methods.
  - changes to the `Collection` api to be more `Map` like for reads, with `get`, `has`, `size`, `entries`, `keys`, and `values`.
  - renames `config.getId` to `config.getKey` for consistency with the `Map` like api.

- Fix ordering of ts update overloads & fix a lot of type errors in tests ([#166](https://github.com/TanStack/db/pull/166))

- fix string comparison when sorting in descending order ([#165](https://github.com/TanStack/db/pull/165))

- update to the latest d2ts, this brings improvements to the hashing of changes in the d2 pipeline ([#168](https://github.com/TanStack/db/pull/168))

## 0.0.7

### Patch Changes

- Expose utilities on collection instances ([#161](https://github.com/TanStack/db/pull/161))

  Implemented a utility exposure pattern for TanStack DB collections that allows utility functions to be passed as part of collection options and exposes them under a `.utils` namespace, with full TypeScript typing.
  - Refactored `createCollection` in packages/db/src/collection.ts to accept options with utilities directly
  - Added `utils` property to CollectionImpl
  - Added TypeScript types for utility functions and utility records
  - Changed Collection from a class to a type, updating all usages to use createCollection() instead
  - Updated Electric/Query implementations
  - Utilities are now ergonomically accessible under `.utils`
  - Full TypeScript typing is preserved for both collection data and utilities
  - API is clean and straightforward - users can call `createCollection(optionsCreator(config))` directly
  - Zero-boilerplate TypeScript pattern that infers utility types automatically

## 0.0.6

### Patch Changes

- live query where clauses can now be a callback function that receives each row as a context object allowing full javascript access to the row data for filtering ([#152](https://github.com/TanStack/db/pull/152))

- the live query select clause can now be a callback function that receives each row as a context object returning a new object with the selected fields. This also allows the for the callback to make more expressive changes to the returned data. ([#154](https://github.com/TanStack/db/pull/154))

- This change introduces a more streamlined and intuitive API for handling mutations by allowing `onInsert`, `onUpdate`, and `onDelete` handlers to be defined directly on the collection configuration. ([#156](https://github.com/TanStack/db/pull/156))

  When `collection.insert()`, `.update()`, or `.delete()` are called outside of an explicit transaction (i.e., not within `useOptimisticMutation`), the library now automatically creates a single-operation transaction and invokes the corresponding handler to persist the change.

  Key changes:
  - **`@tanstack/db`**: The `Collection` class now supports `onInsert`, `onUpdate`, and `onDelete` in its configuration. Direct calls to mutation methods will throw an error if the corresponding handler is not defined.
  - **`@tanstack/db-collections`**:
    - `queryCollectionOptions` now accepts the new handlers and will automatically `refetch` the collection's query after a handler successfully completes. This behavior can be disabled if the handler returns `{ refetch: false }`.
    - `electricCollectionOptions` also accepts the new handlers. These handlers are now required to return an object with a transaction ID (`{ txid: string }`). The collection then automatically waits for this `txid` to be synced back before resolving the mutation, ensuring consistency.
  - **Breaking Change**: Calling `collection.insert()`, `.update()`, or `.delete()` without being inside a `useOptimisticMutation` callback and without a corresponding persistence handler (`onInsert`, etc.) configured on the collection will now throw an error.

  This new pattern simplifies the most common use cases, making the code more declarative. The `useOptimisticMutation` hook remains available for more complex scenarios, such as transactions involving multiple mutations across different collections.

  ***

  The documentation and the React Todo example application have been significantly refactored to adopt the new direct persistence handler pattern as the primary way to perform mutations.
  - The `README.md` and `docs/overview.md` files have been updated to de-emphasize `useOptimisticMutation` for simple writes. They now showcase the much simpler API of calling `collection.insert()` directly and defining persistence logic in the collection's configuration.
  - The React Todo example (`examples/react/todo/src/App.tsx`) has been completely overhauled. All instances of `useOptimisticMutation` have been removed and replaced with the new `onInsert`, `onUpdate`, and `onDelete` handlers, resulting in cleaner and more concise code.

## 0.0.5

### Patch Changes

- Collections must have a getId function & use an id for update/delete operators ([#134](https://github.com/TanStack/db/pull/134))

- the select operator is not optional on a query, it will default to returning the whole row for a basic query, and a namespaced object when there are joins ([#148](https://github.com/TanStack/db/pull/148))

- the `keyBy` query operator has been removed, keying withing the query pipeline is now automatic ([#144](https://github.com/TanStack/db/pull/144))

- update d2ts to to latest version that improves hashing performance ([#136](https://github.com/TanStack/db/pull/136))

- Switch to Collection options factories instead of extending the Collection class ([#145](https://github.com/TanStack/db/pull/145))

  This refactors `ElectricCollection` and `QueryCollection` into factory functions (`electricCollectionOptions` and `queryCollectionOptions`) that return standard `CollectionConfig` objects and utility functions. Also adds a `createCollection` function to standardize collection instantiation.

## 0.0.4

### Patch Changes

- fix a bug where optimistic operations could be applied to the wrong collection ([#113](https://github.com/TanStack/db/pull/113))

## 0.0.3

### Patch Changes

- fix a bug where query results would not correctly update ([#87](https://github.com/TanStack/db/pull/87))

## 0.0.2

### Patch Changes

- Fixed an issue with injecting the optimistic state removal into the reactive live query. ([#78](https://github.com/TanStack/db/pull/78))

## 0.0.3

### Patch Changes

- Make transactions first class & move ownership of mutationFn from collections to transactions ([#53](https://github.com/TanStack/db/pull/53))

## 0.0.2

### Patch Changes

- make mutationFn optional for read-only collections ([#12](https://github.com/TanStack/db/pull/12))

- Improve test coverage ([#10](https://github.com/TanStack/db/pull/10))

## 0.0.1

### Patch Changes

- feat: Initial release ([#2](https://github.com/TanStack/db/pull/2))
