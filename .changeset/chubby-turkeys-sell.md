---
"@tanstack/db-electric-collection": patch
"@tanstack/db-query-collection": patch
"@tanstack/db-example-react-todo": patch
"@tanstack/db": patch
---

Move Collections to their own packages

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
