---
id: openDatabase
title: openDatabase
---

```ts
function openDatabase(
   name,
   version,
   onUpgrade?,
   idbFactory?,
onBlocked?): Promise<IDBDatabase>;
```

Defined in: packages/db/src/indexed-db-wrapper.ts:88

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

### onBlocked?

(`event`) => `void`

Optional diagnostic callback for native blocked events. The request stays pending.

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
