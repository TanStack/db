# @tanstack/query-db-collection

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
