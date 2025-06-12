# @tanstack/vue-db

## 0.0.6

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

## 0.0.5

### Patch Changes

- Updated dependencies [[`856be72`](https://github.com/TanStack/db/commit/856be725a6299374a3a97c88b50bd5d7bb94b783), [`0455e27`](https://github.com/TanStack/db/commit/0455e27f50d69b1e1887b841dc2f262f4de4c55d), [`80fdac7`](https://github.com/TanStack/db/commit/80fdac76389ea741f5743bc788df375f63fb767b)]:
  - @tanstack/db@0.0.6

## 0.0.4

### Patch Changes

- Collections must have a getId function & use an id for update/delete operators ([#134](https://github.com/TanStack/db/pull/134))

- the `keyBy` query operator has been removed, keying withing the query pipeline is now automatic ([#144](https://github.com/TanStack/db/pull/144))

- Updated dependencies [[`1fbb844`](https://github.com/TanStack/db/commit/1fbb8447d8425d37cb9ab4f078ffab999b28b06c), [`338efc2`](https://github.com/TanStack/db/commit/338efc229c3794da5ac373b8b26143e379433407), [`ee5d026`](https://github.com/TanStack/db/commit/ee5d026715962dd0232fcaca513a8fac9189dce2), [`e7b036c`](https://github.com/TanStack/db/commit/e7b036ce6ebd17c94cc944d6d96ca2c645921c3e), [`e4feb0c`](https://github.com/TanStack/db/commit/e4feb0c214835675b47f0aa18a72d004a423df03)]:
  - @tanstack/db@0.0.5

## 0.0.3

### Patch Changes

- Updated dependencies [[`8ce449e`](https://github.com/TanStack/db/commit/8ce449ed6d070e9e591d1b74b0db5fed7a3fc92f)]:
  - @tanstack/db@0.0.4

## 0.0.2

### Patch Changes

- Updated dependencies [[`b29420b`](https://github.com/TanStack/db/commit/b29420bcdae30dfeffeef63a8753b83306a54e5a)]:
  - @tanstack/db@0.0.3

## 0.0.1

### Patch Changes

- Add Vue support ([#83](https://github.com/TanStack/db/pull/83))
