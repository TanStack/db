---
id: getAllKeys
title: getAllKeys
---

```ts
function getAllKeys(objectStore): Promise<IDBValidKey[]>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:345](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L345)

Retrieves all keys from an object store.

Uses the native `getAllKeys()` method for efficient bulk key retrieval.

## Parameters

### objectStore

`IDBObjectStore`

The IDBObjectStore to read keys from

## Returns

`Promise`\<`IDBValidKey`[]\>

A promise that resolves to an array of all keys in the store

## Example

```typescript
await executeTransaction(db, 'todos', 'readonly', async (tx, stores) => {
  const allKeys = await getAllKeys(stores.todos)
  console.log('All keys:', allKeys)
})
```
