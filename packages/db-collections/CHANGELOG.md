# @tanstack/db-collections

## 0.0.15

### Patch Changes

- Validate that the txId passed to awaitTxId is a string of numbers ([#193](https://github.com/TanStack/db/pull/193))

## 0.0.14

### Patch Changes

- If a schema is passed, use that for the collection type. ([#186](https://github.com/TanStack/db/pull/186))

  You now must either pass an explicit type or schema - passing both will conflict.

- Updated dependencies [[`f6abe9b`](https://github.com/TanStack/db/commit/f6abe9b94b890487fe960bd72a89e4a75de89d46)]:
  - @tanstack/db@0.0.12

## 0.0.13

### Patch Changes

- Export `ElectricCollectionUtils` & allow passing generic to `createTransaction` ([#179](https://github.com/TanStack/db/pull/179))

- Updated dependencies [[`66ed58b`](https://github.com/TanStack/db/commit/66ed58b66553683ff0a5241de8cde83954d18847), [`c5489ff`](https://github.com/TanStack/db/commit/c5489ff276db07a0a4b65876790ccd7f11a6f99d)]:
  - @tanstack/db@0.0.11

## 0.0.12

### Patch Changes

- Updated dependencies [[`38d4505`](https://github.com/TanStack/db/commit/38d45051b065b619b95849f78422e9ace8750361)]:
  - @tanstack/db@0.0.10

## 0.0.11

### Patch Changes

- Updated dependencies [[`2ae0b09`](https://github.com/TanStack/db/commit/2ae0b09cc52152b0044818b538e11e8ca10d0f80)]:
  - @tanstack/db@0.0.9

## 0.0.10

### Patch Changes

- Type PendingMutation whenever possible ([#163](https://github.com/TanStack/db/pull/163))

- A large refactor of the core `Collection` with: ([#155](https://github.com/TanStack/db/pull/155))

  - a change to not use Store internally and emit fine grade changes with `subscribeChanges` and `subscribeKeyChanges` methods.
  - changes to the `Collection` api to be more `Map` like for reads, with `get`, `has`, `size`, `entries`, `keys`, and `values`.
  - renames `config.getId` to `config.getKey` for consistency with the `Map` like api.

- Updated dependencies [[`5c538cf`](https://github.com/TanStack/db/commit/5c538cf03573512a8d1bbde96962a9f7ca014708), [`9553366`](https://github.com/TanStack/db/commit/955336604a286d7992f9506cb1c76ecf150d0432), [`b4602a0`](https://github.com/TanStack/db/commit/b4602a071cb6866bb1338e30d5802220b0d1fc49), [`02adc81`](https://github.com/TanStack/db/commit/02adc813177cbb44ab6245cc9821142e9cf97876), [`06d8ecc`](https://github.com/TanStack/db/commit/06d8eccc5aaabc194c31ea89c9b4191e2aa68180), [`c50cd51`](https://github.com/TanStack/db/commit/c50cd51ac8030b391cd9d84e8cd8b8fb57cb8ca5)]:
  - @tanstack/db@0.0.8

## 0.0.9

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

## 0.0.8

### Patch Changes

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

- Updated dependencies [[`856be72`](https://github.com/TanStack/db/commit/856be725a6299374a3a97c88b50bd5d7bb94b783), [`0455e27`](https://github.com/TanStack/db/commit/0455e27f50d69b1e1887b841dc2f262f4de4c55d), [`80fdac7`](https://github.com/TanStack/db/commit/80fdac76389ea741f5743bc788df375f63fb767b)]:
  - @tanstack/db@0.0.6

## 0.0.7

### Patch Changes

- Collections must have a getId function & use an id for update/delete operators ([#134](https://github.com/TanStack/db/pull/134))

- Switch to Collection options factories instead of extending the Collection class ([#145](https://github.com/TanStack/db/pull/145))

  This refactors `ElectricCollection` and `QueryCollection` into factory functions (`electricCollectionOptions` and `queryCollectionOptions`) that return standard `CollectionConfig` objects and utility functions. Also adds a `createCollection` function to standardize collection instantiation.

- Updated dependencies [[`1fbb844`](https://github.com/TanStack/db/commit/1fbb8447d8425d37cb9ab4f078ffab999b28b06c), [`338efc2`](https://github.com/TanStack/db/commit/338efc229c3794da5ac373b8b26143e379433407), [`ee5d026`](https://github.com/TanStack/db/commit/ee5d026715962dd0232fcaca513a8fac9189dce2), [`e7b036c`](https://github.com/TanStack/db/commit/e7b036ce6ebd17c94cc944d6d96ca2c645921c3e), [`e4feb0c`](https://github.com/TanStack/db/commit/e4feb0c214835675b47f0aa18a72d004a423df03)]:
  - @tanstack/db@0.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [[`8ce449e`](https://github.com/TanStack/db/commit/8ce449ed6d070e9e591d1b74b0db5fed7a3fc92f)]:
  - @tanstack/db@0.0.4

## 0.0.5

### Patch Changes

- Replace `queryCollection.invalidate()` with `queryCollection.refetch()`. ([#109](https://github.com/TanStack/db/pull/109))

  This means that we actually wait for the collection to be updated before
  discarding local optimistic state.

## 0.0.4

### Patch Changes

- Added staleTime support for QueryCollection ([#104](https://github.com/TanStack/db/pull/104))

## 0.0.3

### Patch Changes

- Updated dependencies [[`b29420b`](https://github.com/TanStack/db/commit/b29420bcdae30dfeffeef63a8753b83306a54e5a)]:
  - @tanstack/db@0.0.3

## 0.0.2

### Patch Changes

- Added QueryCollection ([#78](https://github.com/TanStack/db/pull/78))

- Updated dependencies [[`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672)]:
  - @tanstack/db@0.0.2
