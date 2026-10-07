---
id: getAll
title: getAll
---

```ts
function getAll<T>(objectStore): Promise<T[]>;
```

Defined in: packages/db/src/indexed-db-wrapper.ts:341

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
