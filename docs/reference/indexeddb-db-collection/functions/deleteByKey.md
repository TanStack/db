---
id: deleteByKey
title: deleteByKey
---

```ts
function deleteByKey(objectStore, key): Promise<void>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:437](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L437)

Deletes an item by its key from an object store.

## Parameters

### objectStore

`IDBObjectStore`

The IDBObjectStore to delete from

### key

`IDBValidKey`

The key of the item to delete

## Returns

`Promise`\<`void`\>

A promise that resolves when the item is deleted

## Example

```typescript
await executeTransaction(db, 'todos', 'readwrite', async (tx, stores) => {
  await deleteByKey(stores.todos, 1)
  console.log('Todo deleted')
})
```
