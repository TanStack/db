# @tanstack/db

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
