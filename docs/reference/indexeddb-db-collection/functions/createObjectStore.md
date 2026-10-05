---
id: createObjectStore
title: createObjectStore
---

```ts
function createObjectStore(
   db,
   storeName,
   options?): IDBObjectStore;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:167](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L167)

Creates an object store during a database upgrade.

This function must be called within an onupgradeneeded callback
(i.e., within a versionchange transaction). Calling it outside of
an upgrade context will throw an error.

## Parameters

### db

`IDBDatabase`

The IDBDatabase instance

### storeName

`string`

The name of the object store to create

### options?

`IDBObjectStoreParameters`

Optional configuration for the object store (keyPath, autoIncrement)

## Returns

`IDBObjectStore`

The created IDBObjectStore

## Throws

Error if not called during a version change transaction

## Example

```typescript
const db = await openDatabase('myApp', 1, (db) => {
  createObjectStore(db, 'todos', { keyPath: 'id' })
  createObjectStore(db, 'users', { keyPath: 'id', autoIncrement: true })
})
```
