---
id: BaseCollectionConfig
title: BaseCollectionConfig
---

# Interface: BaseCollectionConfig\<T, TKey, TSchema, TUtils, TReturn\>

Defined in: [packages/db/src/types.ts:416](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L416)

## Extended by

- [`CollectionConfig`](../CollectionConfig.md)
- [`LocalStorageCollectionConfig`](../LocalStorageCollectionConfig.md)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

### TUtils

`TUtils` *extends* [`UtilsRecord`](../../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../../type-aliases/UtilsRecord.md)

### TReturn

`TReturn` = `any`

## Properties

### autoIndex?

```ts
optional autoIndex: "eager" | "off";
```

Defined in: [packages/db/src/types.ts:465](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L465)

Auto-indexing mode for the collection.
When enabled, indexes will be automatically created for simple where expressions.

#### Default

```ts
"eager"
```

#### Description

- "off": No automatic indexing
- "eager": Automatically create indexes for simple where expressions in subscribeChanges (default)

***

### compare()?

```ts
optional compare: (x, y) => number;
```

Defined in: [packages/db/src/types.ts:476](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L476)

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

### defaultStringCollation?

```ts
optional defaultStringCollation: StringCollationConfig;
```

Defined in: [packages/db/src/types.ts:622](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L622)

Specifies how to compare data in the collection.
This should be configured to match data ordering on the backend.
E.g., when using the Electric DB collection these options
      should match the database's collation settings.

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/db/src/types.ts:445](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L445)

Time in milliseconds after which the collection will be garbage collected
when it has no active subscribers. Defaults to 5 minutes (300000ms).

***

### getKey()

```ts
getKey: (item) => TKey;
```

Defined in: [packages/db/src/types.ts:440](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L440)

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

Defined in: [packages/db/src/types.ts:429](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L429)

***

### onDelete?

```ts
optional onDelete: DeleteMutationFn<T, TKey, TUtils, TReturn>;
```

Defined in: [packages/db/src/types.ts:614](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L614)

Optional asynchronous handler function called before a delete operation

#### Param

Object containing transaction and collection information

#### Returns

Promise resolving to any value

#### Examples

```ts
// Basic delete handler
onDelete: async ({ transaction, collection }) => {
  const deletedKey = transaction.mutations[0].key
  await api.deleteTodo(deletedKey)
}
```

```ts
// Delete handler with multiple items
onDelete: async ({ transaction, collection }) => {
  const keysToDelete = transaction.mutations.map(m => m.key)
  await api.deleteTodos(keysToDelete)
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
optional onInsert: InsertMutationFn<T, TKey, TUtils, TReturn>;
```

Defined in: [packages/db/src/types.ts:527](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L527)

Optional asynchronous handler function called before an insert operation

#### Param

Object containing transaction and collection information

#### Returns

Promise resolving to any value

#### Examples

```ts
// Basic insert handler
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.createTodo(newItem)
}
```

```ts
// Insert handler with multiple items
onInsert: async ({ transaction, collection }) => {
  const items = transaction.mutations.map(m => m.modified)
  await api.createTodos(items)
}
```

```ts
// Insert handler with error handling
onInsert: async ({ transaction, collection }) => {
  try {
    const newItem = transaction.mutations[0].modified
    const result = await api.createTodo(newItem)
    return result
  } catch (error) {
    console.error('Insert failed:', error)
    throw error // This will cause the transaction to fail
  }
}
```

```ts
// Insert handler with metadata
onInsert: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  await api.createTodo(mutation.modified, {
    source: mutation.metadata?.source,
    timestamp: mutation.createdAt
  })
}
```

***

### onUpdate?

```ts
optional onUpdate: UpdateMutationFn<T, TKey, TUtils, TReturn>;
```

Defined in: [packages/db/src/types.ts:571](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L571)

Optional asynchronous handler function called before an update operation

#### Param

Object containing transaction and collection information

#### Returns

Promise resolving to any value

#### Examples

```ts
// Basic update handler
onUpdate: async ({ transaction, collection }) => {
  const updatedItem = transaction.mutations[0].modified
  await api.updateTodo(updatedItem.id, updatedItem)
}
```

```ts
// Update handler with partial updates
onUpdate: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  const changes = mutation.changes // Only the changed fields
  await api.updateTodo(mutation.original.id, changes)
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

Defined in: [packages/db/src/types.ts:430](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L430)

***

### startSync?

```ts
optional startSync: boolean;
```

Defined in: [packages/db/src/types.ts:456](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L456)

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

Defined in: [packages/db/src/types.ts:485](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L485)

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

Defined in: [packages/db/src/types.ts:624](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L624)
