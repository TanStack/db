# examples/react/todo

## 0.0.33

### Patch Changes

- Updated dependencies []:
  - @tanstack/electric-db-collection@0.0.9
  - @tanstack/query-db-collection@0.0.9
  - @tanstack/react-db@0.0.27
  - @tanstack/trailbase-db-collection@0.0.3

## 0.0.32

### Patch Changes

- Add initial release of TrailBase collection for TanStack DB. TrailBase is a blazingly fast, open-source alternative to Firebase built on Rust, SQLite, and V8. It provides type-safe REST and realtime APIs with sub-millisecond latencies, integrated authentication, and flexible access control - all in a single executable. This collection type enables seamless integration with TrailBase backends for high-performance real-time applications. ([#228](https://github.com/TanStack/db/pull/228))

- Updated dependencies [[`09c6995`](https://github.com/TanStack/db/commit/09c6995ea9c8e6979d077ca63cbdd6215054ae78)]:
  - @tanstack/trailbase-db-collection@0.0.2
  - @tanstack/electric-db-collection@0.0.8
  - @tanstack/query-db-collection@0.0.8
  - @tanstack/react-db@0.0.26

## 0.0.31

### Patch Changes

- Updated dependencies [[`20f810e`](https://github.com/TanStack/db/commit/20f810e13a7d802bf56da6f0df89b34312ebb2fd)]:
  - @tanstack/electric-db-collection@0.0.7
  - @tanstack/query-db-collection@0.0.7
  - @tanstack/react-db@0.0.25

## 0.0.30

### Patch Changes

- Updated dependencies []:
  - @tanstack/electric-db-collection@0.0.6
  - @tanstack/query-db-collection@0.0.6
  - @tanstack/react-db@0.0.24

## 0.0.29

### Patch Changes

- Updated dependencies []:
  - @tanstack/electric-db-collection@0.0.5
  - @tanstack/query-db-collection@0.0.5
  - @tanstack/react-db@0.0.23

## 0.0.28

### Patch Changes

- Updated dependencies []:
  - @tanstack/electric-db-collection@0.0.4
  - @tanstack/query-db-collection@0.0.4
  - @tanstack/react-db@0.0.22

## 0.0.27

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

- Updated dependencies [[`8e23322`](https://github.com/TanStack/db/commit/8e233229b25eabed07cdaf12948ba913786bf4f9)]:
  - @tanstack/electric-db-collection@0.0.3
  - @tanstack/query-db-collection@0.0.3
  - @tanstack/react-db@0.0.21

## 0.0.26

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.24
  - @tanstack/react-db@0.0.20

## 0.0.25

### Patch Changes

- - [Breaking change for the Electric Collection]: Use numbers for txid ([#245](https://github.com/TanStack/db/pull/245))
  - misc type fixes
- Updated dependencies [[`9f0b0c2`](https://github.com/TanStack/db/commit/9f0b0c28ede99273eb5914be28aff55b91c50778)]:
  - @tanstack/db-collections@0.0.23
  - @tanstack/react-db@0.0.19

## 0.0.24

### Patch Changes

- Updated dependencies [[`266bd29`](https://github.com/TanStack/db/commit/266bd29514c6c0fa9e903986ca11c5e22f4d2361)]:
  - @tanstack/db-collections@0.0.22
  - @tanstack/react-db@0.0.18

## 0.0.23

### Patch Changes

- Updated dependencies [[`1c9e867`](https://github.com/TanStack/db/commit/1c9e8676405b71a45831456c7119420975ae1456)]:
  - @tanstack/db-collections@0.0.21
  - @tanstack/react-db@0.0.17

## 0.0.22

### Patch Changes

- Updated dependencies [[`e478d53`](https://github.com/TanStack/db/commit/e478d5353cc8fc64e3a29dda1f86fba863cf6ce8)]:
  - @tanstack/react-db@0.0.16
  - @tanstack/db-collections@0.0.20

## 0.0.21

### Patch Changes

- Updated dependencies [[`0912a7c`](https://github.com/TanStack/db/commit/0912a7c165325e6981f0b702c169004e08d57f75)]:
  - @tanstack/db-collections@0.0.19
  - @tanstack/react-db@0.0.15

## 0.0.20

### Patch Changes

- Updated dependencies [[`0dede0a`](https://github.com/TanStack/db/commit/0dede0ab75e66df9797d5c898defdc66685c6f91)]:
  - @tanstack/db-collections@0.0.18

## 0.0.19

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.17
  - @tanstack/react-db@0.0.14

## 0.0.18

### Patch Changes

- Updated dependencies [[`945868e`](https://github.com/TanStack/db/commit/945868e95944543ccf5d778409548679a952e249), [`57b5f5d`](https://github.com/TanStack/db/commit/57b5f5de6297326a57ef205a400428af0697b48b)]:
  - @tanstack/react-db@0.0.13
  - @tanstack/db-collections@0.0.16

## 0.0.17

### Patch Changes

- Updated dependencies [[`5cafaf4`](https://github.com/TanStack/db/commit/5cafaf4f73018599ce799778029833d3fa83dbc9)]:
  - @tanstack/db-collections@0.0.15

## 0.0.16

### Patch Changes

- Updated dependencies [[`f6abe9b`](https://github.com/TanStack/db/commit/f6abe9b94b890487fe960bd72a89e4a75de89d46)]:
  - @tanstack/db-collections@0.0.14
  - @tanstack/react-db@0.0.12

## 0.0.15

### Patch Changes

- Export `ElectricCollectionUtils` & allow passing generic to `createTransaction` ([#179](https://github.com/TanStack/db/pull/179))

- Updated dependencies [[`c5489ff`](https://github.com/TanStack/db/commit/c5489ff276db07a0a4b65876790ccd7f11a6f99d)]:
  - @tanstack/db-collections@0.0.13
  - @tanstack/react-db@0.0.11

## 0.0.14

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.12
  - @tanstack/react-db@0.0.10

## 0.0.13

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.11
  - @tanstack/react-db@0.0.9

## 0.0.12

### Patch Changes

- Type PendingMutation whenever possible ([#163](https://github.com/TanStack/db/pull/163))

- Updated dependencies [[`5c538cf`](https://github.com/TanStack/db/commit/5c538cf03573512a8d1bbde96962a9f7ca014708), [`b4602a0`](https://github.com/TanStack/db/commit/b4602a071cb6866bb1338e30d5802220b0d1fc49)]:
  - @tanstack/db-collections@0.0.10
  - @tanstack/react-db@0.0.8

## 0.0.11

### Patch Changes

- Updated dependencies [[`8b43ad3`](https://github.com/TanStack/db/commit/8b43ad305b277560aed660c31cf1409d22ed1e47)]:
  - @tanstack/db-collections@0.0.9
  - @tanstack/react-db@0.0.7

## 0.0.10

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

- Updated dependencies [[`80fdac7`](https://github.com/TanStack/db/commit/80fdac76389ea741f5743bc788df375f63fb767b)]:
  - @tanstack/db-collections@0.0.8
  - @tanstack/react-db@0.0.6

## 0.0.9

### Patch Changes

- Collections must have a getId function & use an id for update/delete operators ([#134](https://github.com/TanStack/db/pull/134))

- Switch to Collection options factories instead of extending the Collection class ([#145](https://github.com/TanStack/db/pull/145))

  This refactors `ElectricCollection` and `QueryCollection` into factory functions (`electricCollectionOptions` and `queryCollectionOptions`) that return standard `CollectionConfig` objects and utility functions. Also adds a `createCollection` function to standardize collection instantiation.

- Updated dependencies [[`1fbb844`](https://github.com/TanStack/db/commit/1fbb8447d8425d37cb9ab4f078ffab999b28b06c), [`ee5d026`](https://github.com/TanStack/db/commit/ee5d026715962dd0232fcaca513a8fac9189dce2), [`e4feb0c`](https://github.com/TanStack/db/commit/e4feb0c214835675b47f0aa18a72d004a423df03)]:
  - @tanstack/db-collections@0.0.7
  - @tanstack/react-db@0.0.5

## 0.0.8

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.6
  - @tanstack/react-db@0.0.4

## 0.0.7

### Patch Changes

- Updated dependencies [[`0bbf4c4`](https://github.com/TanStack/db/commit/0bbf4c46e01b382a70a437f05dfc09c9ff749a15)]:
  - @tanstack/db-collections@0.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [[`2d0fcf1`](https://github.com/TanStack/db/commit/2d0fcf16a61a3fcd6a7220b5501640cc0f67218f)]:
  - @tanstack/db-collections@0.0.4

## 0.0.5

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.3
  - @tanstack/react-db@0.0.3

## 0.0.4

### Patch Changes

- Updated dependencies [[`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672), [`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672)]:
  - @tanstack/react-db@0.0.2
  - @tanstack/db-collections@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [[`b42479c`](https://github.com/TanStack/db/commit/b42479cf95f9a820b36e01684b13a9179973f3d8)]:
  - @tanstack/react-db@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [[`9bb6e89`](https://github.com/TanStack/db/commit/9bb6e8909cebdcd7c03091bfc12dd37f5ab2e1ea)]:
  - @tanstack/react-db@0.0.2
