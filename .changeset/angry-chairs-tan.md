---
"@tanstack/db-collections": patch
"@tanstack/react-db": patch
"@tanstack/vue-db": patch
"@tanstack/db": patch
---

Expose utilities on collection instances

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
