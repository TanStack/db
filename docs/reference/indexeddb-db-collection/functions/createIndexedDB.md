---
id: createIndexedDB
title: createIndexedDB
---

```ts
function createIndexedDB(options): Promise<IndexedDBInstance>;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:284](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L284)

Creates or opens an IndexedDB database with the specified stores.
Call this once at app startup, then pass the instance to collections.
The connection closes on versionchange so another context can upgrade or
delete the database. Affected Collections enter error and retain their rows.
Recreate affected Collections with a new instance before
further persistence.

All stores are created in a single upgrade transaction, avoiding
version race conditions when multiple collections share a database.

## Parameters

### options

[`CreateIndexedDBOptions`](../interfaces/CreateIndexedDBOptions.md)

## Returns

`Promise`\<[`IndexedDBInstance`](../interfaces/IndexedDBInstance.md)\>

## Example

```typescript
const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos', 'users', 'settings'],
})

const todosCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    getKey: (item: { id: string }) => item.id,
  })
)
```
