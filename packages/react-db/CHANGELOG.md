# @tanstack/react-db

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

- Updated dependencies [[`945868e`](https://github.com/TanStack/db/commit/945868e95944543ccf5d778409548679a952e249), [`0f8a008`](https://github.com/TanStack/db/commit/0f8a008be8b368f231c8518ad1adfcac08132da2), [`57b5f5d`](https://github.com/TanStack/db/commit/57b5f5de6297326a57ef205a400428af0697b48b)]:
  - @tanstack/db@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [[`f6abe9b`](https://github.com/TanStack/db/commit/f6abe9b94b890487fe960bd72a89e4a75de89d46)]:
  - @tanstack/db@0.0.12

## 0.0.11

### Patch Changes

- Export `ElectricCollectionUtils` & allow passing generic to `createTransaction` ([#179](https://github.com/TanStack/db/pull/179))

- Updated dependencies [[`66ed58b`](https://github.com/TanStack/db/commit/66ed58b66553683ff0a5241de8cde83954d18847), [`c5489ff`](https://github.com/TanStack/db/commit/c5489ff276db07a0a4b65876790ccd7f11a6f99d)]:
  - @tanstack/db@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [[`38d4505`](https://github.com/TanStack/db/commit/38d45051b065b619b95849f78422e9ace8750361)]:
  - @tanstack/db@0.0.10

## 0.0.9

### Patch Changes

- Updated dependencies [[`2ae0b09`](https://github.com/TanStack/db/commit/2ae0b09cc52152b0044818b538e11e8ca10d0f80)]:
  - @tanstack/db@0.0.9

## 0.0.8

### Patch Changes

- A large refactor of the core `Collection` with: ([#155](https://github.com/TanStack/db/pull/155))

  - a change to not use Store internally and emit fine grade changes with `subscribeChanges` and `subscribeKeyChanges` methods.
  - changes to the `Collection` api to be more `Map` like for reads, with `get`, `has`, `size`, `entries`, `keys`, and `values`.
  - renames `config.getId` to `config.getKey` for consistency with the `Map` like api.

- Updated dependencies [[`5c538cf`](https://github.com/TanStack/db/commit/5c538cf03573512a8d1bbde96962a9f7ca014708), [`9553366`](https://github.com/TanStack/db/commit/955336604a286d7992f9506cb1c76ecf150d0432), [`b4602a0`](https://github.com/TanStack/db/commit/b4602a071cb6866bb1338e30d5802220b0d1fc49), [`02adc81`](https://github.com/TanStack/db/commit/02adc813177cbb44ab6245cc9821142e9cf97876), [`06d8ecc`](https://github.com/TanStack/db/commit/06d8eccc5aaabc194c31ea89c9b4191e2aa68180), [`c50cd51`](https://github.com/TanStack/db/commit/c50cd51ac8030b391cd9d84e8cd8b8fb57cb8ca5)]:
  - @tanstack/db@0.0.8

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

- Updated dependencies [[`8b43ad3`](https://github.com/TanStack/db/commit/8b43ad305b277560aed660c31cf1409d22ed1e47)]:
  - @tanstack/db@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [[`856be72`](https://github.com/TanStack/db/commit/856be725a6299374a3a97c88b50bd5d7bb94b783), [`0455e27`](https://github.com/TanStack/db/commit/0455e27f50d69b1e1887b841dc2f262f4de4c55d), [`80fdac7`](https://github.com/TanStack/db/commit/80fdac76389ea741f5743bc788df375f63fb767b)]:
  - @tanstack/db@0.0.6

## 0.0.5

### Patch Changes

- Collections must have a getId function & use an id for update/delete operators ([#134](https://github.com/TanStack/db/pull/134))

- the `keyBy` query operator has been removed, keying withing the query pipeline is now automatic ([#144](https://github.com/TanStack/db/pull/144))

- Updated dependencies [[`1fbb844`](https://github.com/TanStack/db/commit/1fbb8447d8425d37cb9ab4f078ffab999b28b06c), [`338efc2`](https://github.com/TanStack/db/commit/338efc229c3794da5ac373b8b26143e379433407), [`ee5d026`](https://github.com/TanStack/db/commit/ee5d026715962dd0232fcaca513a8fac9189dce2), [`e7b036c`](https://github.com/TanStack/db/commit/e7b036ce6ebd17c94cc944d6d96ca2c645921c3e), [`e4feb0c`](https://github.com/TanStack/db/commit/e4feb0c214835675b47f0aa18a72d004a423df03)]:
  - @tanstack/db@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [[`8ce449e`](https://github.com/TanStack/db/commit/8ce449ed6d070e9e591d1b74b0db5fed7a3fc92f)]:
  - @tanstack/db@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [[`b29420b`](https://github.com/TanStack/db/commit/b29420bcdae30dfeffeef63a8753b83306a54e5a)]:
  - @tanstack/db@0.0.3

## 0.0.2

### Patch Changes

- Fixed an issue with injecting the optimistic state removal into the reactive live query. ([#78](https://github.com/TanStack/db/pull/78))

- Updated dependencies [[`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672)]:
  - @tanstack/db@0.0.2

## 0.0.3

### Patch Changes

- Make transactions first class & move ownership of mutationFn from collections to transactions ([#53](https://github.com/TanStack/db/pull/53))

- Updated dependencies [[`b42479c`](https://github.com/TanStack/db/commit/b42479cf95f9a820b36e01684b13a9179973f3d8)]:
  - @tanstack/db@0.0.3

## 0.0.2

### Patch Changes

- make mutationFn optional for read-only collections ([#12](https://github.com/TanStack/db/pull/12))

- Updated dependencies [[`9bb6e89`](https://github.com/TanStack/db/commit/9bb6e8909cebdcd7c03091bfc12dd37f5ab2e1ea), [`8eb7e9b`](https://github.com/TanStack/db/commit/8eb7e9b1d1f569c5c064e0f440257589486b73cf)]:
  - @tanstack/db@0.0.2

## 0.0.1

### Patch Changes

- feat: Initial release ([#2](https://github.com/TanStack/db/pull/2))

- Updated dependencies [[`2d2dd77`](https://github.com/TanStack/db/commit/2d2dd7743f715ffefaeee8e8d11173b751c7043b)]:
  - @tanstack/db@0.0.1
