# @tanstack/db

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
  if (tx.state === "failed") {
    console.error("Failed:", tx.error)
  }

  // After - commit() now throws
  try {
    await tx.commit()
  } catch (error) {
    console.error("Failed:", error)
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
    if (error.message.includes("already exists")) {
      // Handle duplicate key error
    }
  }
  ```

  **After:**

  ```ts
  import { DuplicateKeyError } from "@tanstack/db"

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
  import { ElectricInsertHandlerMustReturnTxIdError } from "@tanstack/db"
  ```

  **After:**

  ```ts
  // Now import from the specific adapter package
  import { ElectricInsertHandlerMustReturnTxIdError } from "@tanstack/electric-db-collection"
  ```

  ### Unified Error Handling

  **New:**

  ```ts
  import { TanStackDBError } from "@tanstack/db"

  try {
    // Any TanStack DB operation
  } catch (error) {
    if (error instanceof TanStackDBError) {
      // Handle all TanStack DB errors uniformly
      console.log("TanStack DB error:", error.message)
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
