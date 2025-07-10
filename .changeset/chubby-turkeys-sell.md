---
"@tanstack/db-electric-collection": patch
"@tanstack/db-query-collection": patch
"@tanstack/db-example-react-todo": patch
"@tanstack/db": patch
---

Move Collections to their own packages

- Move local-only and local-storage collections to main `@tanstack/db` package
- Create new `@tanstack/db-electric-collection` package for Electric SQL integration
- Create new `@tanstack/db-query-collection` package for TanStack Query integration
- Delete `@tanstack/db-collections` package (removed from repo)
- Update example app and documentation to use new package structure

**New structure:**

- `@tanstack/db` - now includes local-only & local-storage collections
- `@tanstack/db-electric-collection` - Electric SQL integration (v0.0.1)
- `@tanstack/db-query-collection` - TanStack Query integration (v0.0.1)
- `@tanstack/db-collections` - ❌ deleted from repo

- Better separation of concerns
- Independent versioning for each collection type
- Cleaner dependencies (electric collections don't need query deps, etc.)
