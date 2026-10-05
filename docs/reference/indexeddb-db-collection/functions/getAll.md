---
id: getAll
title: getAll
---

```ts
function getAll<T>(objectStore): Promise<T[]>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:322](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L322)

Retrieves all items from an object store.

Uses the native `getAll()` method for efficient bulk retrieval.

## Type Parameters

### T

`T`

The type of items in the object store

## Parameters

### objectStore

`IDBObjectStore`

The IDBObjectStore to read from

## Returns

`Promise`\<`T`[]\>

A promise that resolves to an array of all items in the store

## Example

```typescript
await executeTransaction(db, 'todos', 'readonly', async (tx, stores) => {
  const allTodos = await getAll<Todo>(stores.todos)
  console.log('All todos:', allTodos)
})
```
