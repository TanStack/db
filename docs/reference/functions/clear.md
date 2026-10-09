---
id: clear
title: clear
---

```ts
function clear(objectStore): Promise<void>;
```

Defined in: packages/db/src/indexed-db-wrapper.ts:481

Removes all items from an object store.

## Parameters

### objectStore

`IDBObjectStore`

The IDBObjectStore to clear

## Returns

`Promise`\<`void`\>

A promise that resolves when all items are removed

## Example

```typescript
await executeTransaction(db, 'todos', 'readwrite', async (tx, stores) => {
  await clear(stores.todos)
  console.log('All todos cleared')
})
```
