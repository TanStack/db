---
id: put
title: put
---

```ts
function put<T>(
   objectStore,
   value,
key?): Promise<IDBValidKey>;
```

Defined in: [packages/indexeddb-db-collection/src/wrapper.ts:429](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L429)

Writes an item to an object store using upsert semantics.

If an item with the same key exists, it will be replaced.
If no item with the key exists, a new one will be created.

## Type Parameters

### T

`T`

The type of the item

## Parameters

### objectStore

`IDBObjectStore`

The IDBObjectStore to write to

### value

`T`

The item to write

### key?

`IDBValidKey`

Optional key for the item. Required if the object store doesn't have a keyPath.

## Returns

`Promise`\<`IDBValidKey`\>

A promise that resolves to the key of the written item

## Example

```typescript
// With keyPath (key extracted from value)
await executeTransaction(db, 'todos', 'readwrite', async (tx, stores) => {
  const key = await put(stores.todos, { id: 1, text: 'Buy milk' })
  console.log('Wrote item with key:', key)
})

// Without keyPath (explicit key)
await executeTransaction(db, 'items', 'readwrite', async (tx, stores) => {
  const key = await put(stores.items, { text: 'Some data' }, 'myKey')
  console.log('Wrote item with key:', key)
})
```
