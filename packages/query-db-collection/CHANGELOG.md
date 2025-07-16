# @tanstack/query-db-collection

## 0.0.7

### Patch Changes

- Add explicit collection readiness detection with `isReady()` and `markReady()` ([#270](https://github.com/TanStack/db/pull/270))
  - Add `isReady()` method to check if a collection is ready for use
  - Add `onFirstReady()` method to register callbacks for when collection becomes ready
  - Add `markReady()` to SyncConfig interface for sync implementations to explicitly signal readiness
  - Replace `onFirstCommit()` with `onFirstReady()` for better semantics
  - Update status state machine to allow `loading` → `ready` transition for cases with no data to commit
  - Update all sync implementations (Electric, Query, Local-only, Local-storage) to use `markReady()`
  - Improve error handling by allowing collections to be marked ready even when sync errors occur

  This provides a more intuitive and ergonomic API for determining collection readiness, replacing the previous approach of using commits as a readiness signal.

- Updated dependencies [[`1758eda`](https://github.com/TanStack/db/commit/1758edab9608383d9d1470156021ee632f043e51), [`20f810e`](https://github.com/TanStack/db/commit/20f810e13a7d802bf56da6f0df89b34312ebb2fd)]:
  - @tanstack/db@0.0.25

## 0.0.6

### Patch Changes

- Updated dependencies [[`11215d9`](https://github.com/TanStack/db/commit/11215d9544d02e9dc6258c661ba4b5e439e479ed), [`fe42591`](https://github.com/TanStack/db/commit/fe42591bd7ea9955d67ecec4471b44cb7808e74b), [`665efe6`](https://github.com/TanStack/db/commit/665efe660c1aed68139326a2a33904968622a882)]:
  - @tanstack/db@0.0.24

## 0.0.5

### Patch Changes

- Updated dependencies [[`056609e`](https://github.com/TanStack/db/commit/056609ed2926e12df5ee08be5fad0a6333e787f3)]:
  - @tanstack/db@0.0.23

## 0.0.4

### Patch Changes

- Updated dependencies [[`aeee9a1`](https://github.com/TanStack/db/commit/aeee9a13411527bd0ebfc0a0c06989bdb904b650)]:
  - @tanstack/db@0.0.22

## 0.0.3

### Patch Changes

- Move Collections to their own packages ([#252](https://github.com/TanStack/db/pull/252))
  - Move local-only and local-storage collections to main `@tanstack/db` package
  - Create new `@tanstack/electric-db-collection` package for Electric SQL integration
  - Create new `@tanstack/query-db-collection` package for TanStack Query integration
  - Delete `@tanstack/db-collections` package (removed from repo)
  - Update example app and documentation to use new package structure

  Why?
  - Better separation of concerns
  - Independent versioning for each collection type
  - Cleaner dependencies (electric collections don't need query deps, etc.)
  - Easier to add more collection types moving forward

- Updated dependencies [[`8e23322`](https://github.com/TanStack/db/commit/8e233229b25eabed07cdaf12948ba913786bf4f9)]:
  - @tanstack/db@0.0.21
