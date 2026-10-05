---
id: deleteDatabase
title: deleteDatabase
---

```ts
function deleteDatabase(name, idbFactory?): Promise<void>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/wrapper.ts:485](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L485)

Deletes an entire IndexedDB database.
A blocked request stays pending until native success or error.

Use with caution - this removes the database and all of its object stores and data.

## Parameters

### name

`string`

The name of the database to delete

### idbFactory?

`IDBFactory`

Optional IDBFactory for testing/mocking

## Returns

`Promise`\<`void`\>

A promise that resolves when the database is deleted

## Example

```typescript
await deleteDatabase('myApp')
console.log('Database deleted')
```
