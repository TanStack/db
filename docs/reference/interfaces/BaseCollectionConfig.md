---
id: BaseCollectionConfig
title: BaseCollectionConfig
---

Defined in: [packages/db/src/types.ts:713](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L713)

## Extended by

- [`CollectionConfig`](CollectionConfig.md)
- [`LocalStorageCollectionConfig`](LocalStorageCollectionConfig.md)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### TReturn

`TReturn` = `any`

## Properties

### autoIndex?

```ts
optional autoIndex: "off" | "eager";
```

Defined in: [packages/db/src/types.ts:767](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L767)

Auto-indexing mode for the collection.
When enabled, indexes will be automatically created for simple where expressions.

#### Default

```ts
"off"
```

#### Description

- "off": No automatic indexing (default). Use explicit indexes for better bundle size.
- "eager": Automatically create indexes for simple where expressions in subscribeChanges.
           Requires setting defaultIndexType.

***

### compare()?

```ts
optional compare: (x, y) => number;
```

Defined in: [packages/db/src/types.ts:792](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L792)

Optional function to compare two items.
This is used to order the items in the collection.

#### Parameters

##### x

`T`

The first item to compare

##### y

`T`

The second item to compare

#### Returns

`number`

A number indicating the order of the items

#### Example

```ts
// For a collection with a 'createdAt' field
compare: (x, y) => x.createdAt.getTime() - y.createdAt.getTime()
```

***

### defaultIndexType?

```ts
optional defaultIndexType: IndexConstructor<TKey>;
```

Defined in: [packages/db/src/types.ts:781](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L781)

Default index type to use when creating indexes without an explicit type.
Required for auto-indexing. Import from '@tanstack/db'.

#### Example

```ts
import { BasicIndex } from '@tanstack/db'
const collection = createCollection({
  defaultIndexType: BasicIndex,
  autoIndex: 'eager',
  // ...
})
```

***

### defaultStringCollation?

```ts
optional defaultStringCollation: StringCollationConfig;
```

Defined in: [packages/db/src/types.ts:987](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L987)

Specifies how to compare data in the collection.
This should be configured to match data ordering on the backend.
E.g., when using the Electric DB collection these options
      should match the database's collation settings.

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/db/src/types.ts:746](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L746)

Time in milliseconds after which the collection will be garbage collected
when it has no active subscribers. Defaults to 5 minutes (300000ms).
Sync started without subscribers gets a minimum 50ms grace period.
Pending preloads retain the collection until they settle. Preloading ready
data refreshes the retention period. A non-positive or non-finite value
disables automatic garbage collection.

***

### getKey()

```ts
getKey: (item) => TKey;
```

Defined in: [packages/db/src/types.ts:737](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L737)

Function to extract the ID from an object
This is required for update/delete operations which now only accept IDs

#### Parameters

##### item

`T`

The item to extract the ID from

#### Returns

`TKey`

The ID string for the item

#### Example

```ts
// For a collection with a 'uuid' field as the primary key
getKey: (item) => item.uuid
```

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:726](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L726)

***

### onDelete?

```ts
optional onDelete: 
  | DeleteMutationFn<T, TKey, TUtils, void>
| DeleteMutationFn<T, TKey, TUtils, TReturn>;
```

Defined in: [packages/db/src/types.ts:976](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L976)

Optional asynchronous handler function called before a delete operation
Returning a value is deprecated; coordinate synchronization through collection utilities instead.

#### Examples

```ts
// Basic delete handler
onDelete: async ({ transaction, collection }) => {
  const deletedKey = transaction.mutations[0].key
  await api.deleteTodo(deletedKey)
}
```

```ts
// Delete handler with refetch (Query Collection)
onDelete: async ({ transaction, collection }) => {
  const keysToDelete = transaction.mutations.map(m => m.key)
  await api.deleteTodos(keysToDelete)
  // Trigger refetch to sync server state
  await collection.utils.refetch()
  // Prevent the pre-1.0 compatibility wrapper from refetching again.
  return { refetch: false }
}
```

```ts
// Delete handler with sync wait (Electric Collection)
onDelete: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  const result = await api.deleteTodo(mutation.original.id)
  // Wait for txid to sync
  await collection.utils.awaitTxId(result.txid)
}
```

```ts
// Delete handler with confirmation
onDelete: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  const shouldDelete = await confirmDeletion(mutation.original)
  if (!shouldDelete) {
    throw new Error('Delete cancelled by user')
  }
  await api.deleteTodo(mutation.original.id)
}
```

```ts
// Delete handler with optimistic rollback
onDelete: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  try {
    await api.deleteTodo(mutation.original.id)
  } catch (error) {
    // Transaction will automatically rollback optimistic changes
    console.error('Delete failed, rolling back:', error)
    throw error
  }
}
```

***

### onInsert?

```ts
optional onInsert: 
  | InsertMutationFn<T, TKey, TUtils, void>
| InsertMutationFn<T, TKey, TUtils, TReturn>;
```

Defined in: [packages/db/src/types.ts:855](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L855)

Optional asynchronous handler function called before an insert operation
Returning a value is deprecated; coordinate synchronization through collection utilities instead.

#### Examples

```ts
// Basic insert handler
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.createTodo(newItem)
}
```

```ts
// Insert handler with refetch (Query Collection)
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.createTodo(newItem)
  // Trigger refetch to sync server state
  await collection.utils.refetch()
  // Prevent the pre-1.0 compatibility wrapper from refetching again.
  return { refetch: false }
}
```

```ts
// Insert handler with sync wait (Electric Collection)
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  const result = await api.createTodo(newItem)
  // Wait for txid to sync
  await collection.utils.awaitTxId(result.txid)
}
```

```ts
// Insert handler with multiple items
onInsert: async ({ transaction, collection }) => {
  const items = transaction.mutations.map(m => m.modified)
  await api.createTodos(items)
  // Refetch to get updated data from server
  await collection.utils.refetch()
  return { refetch: false }
}
```

```ts
// Insert handler with error handling
onInsert: async ({ transaction, collection }) => {
  try {
    const newItem = transaction.mutations[0].modified
    await api.createTodo(newItem)
  } catch (error) {
    console.error('Insert failed:', error)
    throw error // This will cause the transaction to rollback
  }
}
```

***

### onUpdate?

```ts
optional onUpdate: 
  | UpdateMutationFn<T, TKey, TUtils, void>
| UpdateMutationFn<T, TKey, TUtils, TReturn>;
```

Defined in: [packages/db/src/types.ts:917](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L917)

Optional asynchronous handler function called before an update operation
Returning a value is deprecated; coordinate synchronization through collection utilities instead.

#### Examples

```ts
// Basic update handler
onUpdate: async ({ transaction, collection }) => {
  const updatedItem = transaction.mutations[0].modified
  await api.updateTodo(updatedItem.id, updatedItem)
}
```

```ts
// Update handler with refetch (Query Collection)
onUpdate: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  const changes = mutation.changes // Only the changed fields
  await api.updateTodo(mutation.original.id, changes)
  // Trigger refetch to sync server state
  await collection.utils.refetch()
  // Prevent the pre-1.0 compatibility wrapper from refetching again.
  return { refetch: false }
}
```

```ts
// Update handler with sync wait (Electric Collection)
onUpdate: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  const result = await api.updateTodo(mutation.original.id, mutation.changes)
  // Wait for txid to sync
  await collection.utils.awaitTxId(result.txid)
}
```

```ts
// Update handler with multiple items
onUpdate: async ({ transaction, collection }) => {
  const updates = transaction.mutations.map(m => ({
    id: m.key,
    changes: m.changes
  }))
  await api.updateTodos(updates)
  await collection.utils.refetch()
  return { refetch: false }
}
```

```ts
// Update handler with optimistic rollback
onUpdate: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  try {
    await api.updateTodo(mutation.original.id, mutation.changes)
  } catch (error) {
    // Transaction will automatically rollback optimistic changes
    console.error('Update failed, rolling back:', error)
    throw error
  }
}
```

***

### schema?

```ts
optional schema: TSchema;
```

Defined in: [packages/db/src/types.ts:727](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L727)

***

### startSync?

```ts
optional startSync: boolean;
```

Defined in: [packages/db/src/types.ts:757](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L757)

Whether to eagerly start syncing on collection creation.
When true, syncing begins immediately. When false, syncing starts when the first subscriber attaches.

Note: Even with startSync=true, collections will pause syncing when there are no active
subscribers (typically when components querying the collection unmount), resuming when new
subscribers attach. This preserves normal staleTime/gcTime behavior.

#### Default

```ts
false
```

***

### syncMode?

```ts
optional syncMode: SyncMode;
```

Defined in: [packages/db/src/types.ts:801](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L801)

The mode of sync to use for the collection.

#### Default

`eager`

#### Description

- `eager`: syncs all data immediately on preload
- `on-demand`: syncs data in incremental snapshots when the collection is queried
The exact implementation of the sync mode is up to the sync implementation.

***

### utils?

```ts
optional utils: TUtils;
```

Defined in: [packages/db/src/types.ts:989](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L989)
