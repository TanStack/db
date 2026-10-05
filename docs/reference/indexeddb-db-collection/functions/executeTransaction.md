---
id: executeTransaction
title: executeTransaction
---

```ts
function executeTransaction<T>(
   db,
   storeNames,
   mode,
callback): Promise<T>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:233](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L233)

Executes a callback within an IndexedDB transaction.

This function handles transaction lifecycle automatically:
- Creates the transaction with the specified mode
- Provides the transaction and object stores to the callback
- Waits for both the callback and the transaction to complete (or abort)
- Returns the callback's result or rejects with an error

IndexedDB can commit while an async callback is still pending. If that callback
later rejects, this function rejects but cannot undo the committed writes.

## Type Parameters

### T

`T`

The return type of the callback

## Parameters

### db

`IDBDatabase`

The IDBDatabase instance

### storeNames

A single store name or array of store names to include in the transaction

`string` | `string`[]

### mode

`IDBTransactionMode`

The transaction mode ('readonly', 'readwrite', or 'readwriteflush')

### callback

(`transaction`, `stores`) => `T` \| `Promise`\<`T`\>

A function that performs operations within the transaction.
                  Receives the transaction and a record of object stores keyed by name.
                  Can be sync or async.

## Returns

`Promise`\<`T`\>

A promise that resolves to the callback's return value when the transaction completes

## Example

```typescript
// Single store
const result = await executeTransaction(db, 'todos', 'readwrite', (tx, stores) => {
  stores.todos.put({ id: 1, text: 'Buy milk' })
  return 'done'
})

// Multiple stores
await executeTransaction(db, ['todos', 'users'], 'readwrite', (tx, stores) => {
  stores.todos.put({ id: 1, text: 'Task' })
  stores.users.put({ id: 1, name: 'Alice' })
})
```
