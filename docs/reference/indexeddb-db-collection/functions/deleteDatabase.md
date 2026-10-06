---
id: deleteDatabase
title: deleteDatabase
---

```ts
function deleteDatabase(
   name,
   idbFactory?,
onBlocked?): Promise<void>;
```

Defined in: [packages/indexeddb-db-collection/src/wrapper.ts:505](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/wrapper.ts#L505)

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

### onBlocked?

(`event`) => `void`

Optional diagnostic callback for native blocked events. The request stays pending.

## Returns

`Promise`\<`void`\>

A promise that resolves when the database is deleted

## Example

```typescript
await deleteDatabase('myApp')
console.log('Database deleted')
```
