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

This administrative operation targets the name at its turn in IndexedDB's native
connection queue. It does not publish Collection rows. Managed connections close
and their Collections enter `error` on `versionchange`; retained snapshots stay
available. Recreate Collections with a fresh descriptor after the operation. An
unmanaged connection can keep the request pending until its owner closes it.
