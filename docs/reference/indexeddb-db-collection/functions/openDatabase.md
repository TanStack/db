---
id: openDatabase
title: openDatabase
---

```ts
function openDatabase(
   name,
   version,
   onUpgrade?,
idbFactory?): Promise<IDBDatabase>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:82](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L82)

Opens an IndexedDB database with the specified name and version.
A blocked request stays pending until native success or error. The caller
owns the returned connection and must close it when no longer needed.

## Parameters

### name

`string`

The name of the database to open

### version

`number`

The version number of the database schema

### onUpgrade?

(`db`, `oldVersion`, `newVersion`, `transaction`) => `void`

Optional callback that runs during the onupgradeneeded event.
                   Use this to create object stores and indexes.

### idbFactory?

`IDBFactory`

Optional IDBFactory for testing/mocking (defaults to window.indexedDB or globalThis.indexedDB)

## Returns

`Promise`\<`IDBDatabase`\>

A promise that resolves to the IDBDatabase instance

## Example

```typescript
const db = await openDatabase('myApp', 1, (db, oldVersion, newVersion, transaction) => {
  if (oldVersion < 1) {
    db.createObjectStore('todos', { keyPath: 'id' })
  }
})
```
