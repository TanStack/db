---
id: getByKey
title: getByKey
---

```ts
function getByKey<T>(objectStore, key): Promise<T | undefined>;
```

Defined in: [packages/indexeddb-db-collection/src/wrapper.ts:391](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L391)

Retrieves a single item by its key from an object store.

## Type Parameters

### T

`T`

The type of the item

## Parameters

### objectStore

`IDBObjectStore`

The IDBObjectStore to read from

### key

`IDBValidKey`

The key of the item to retrieve

## Returns

`Promise`\<`T` \| `undefined`\>

A promise that resolves to the item, or undefined if not found

## Example

```typescript
await executeTransaction(db, 'todos', 'readonly', async (tx, stores) => {
  const todo = await getByKey<Todo>(stores.todos, 1)
  if (todo) {
    console.log('Found todo:', todo)
  }
})
```
