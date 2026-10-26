---
id: clear
title: clear
---

```ts
function clear(objectStore): Promise<void>;
```

Defined in: [packages/db/src/indexed-db-wrapper.ts:531](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db-wrapper.ts#L531)

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
