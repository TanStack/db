# @tanstack/db

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
