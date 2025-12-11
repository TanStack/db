---
id: LocalOnlyCollectionConfig
title: LocalOnlyCollectionConfig
---

# Interface: LocalOnlyCollectionConfig\<T, TSchema, TKey\>

Defined in: [packages/db/src/local-only.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts#L22)

Configuration interface for Local-only collection options

## Extends

- `Omit`\<[`BaseCollectionConfig`](BaseCollectionConfig.md)\<`T`, `TKey`, `TSchema`, [`LocalOnlyCollectionUtils`](LocalOnlyCollectionUtils.md)\>, `"gcTime"` \| `"startSync"`\>

## Type Parameters

### T

`T` *extends* `object` = `object`

The type of items in the collection

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

The schema type for validation

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key returned by `getKey`

## Properties

### autoIndex?

```ts
optional autoIndex: "eager" | "off";
```

Defined in: [packages/db/src/types.ts:489](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L489)

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

#### Inherited from

[`BaseCollectionConfig`](BaseCollectionConfig.md).[`autoIndex`](BaseCollectionConfig.md#autoindex)

***

### compare()?

```ts
optional compare: (x, y) => number;
```

Defined in: [packages/db/src/types.ts:514](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L514)

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

#### Inherited from

```ts
Omit.compare
```

***

### defaultIndexType?

```ts
optional defaultIndexType: IndexConstructor<TKey>;
```

Defined in: [packages/db/src/types.ts:503](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L503)

Default index type to use when creating indexes without an explicit type.
Required for auto-indexing. Import from '@tanstack/db/indexing'.

#### Example

```ts
import { BasicIndex } from '@tanstack/db/indexing'
const collection = createCollection({
  defaultIndexType: BasicIndex,
  autoIndex: 'eager',
  // ...
})
```

#### Inherited from

```ts
Omit.defaultIndexType
```

***

### defaultStringCollation?

```ts
optional defaultStringCollation: StringCollationConfig;
```

Defined in: [packages/db/src/types.ts:660](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L660)

Specifies how to compare data in the collection.
This should be configured to match data ordering on the backend.
E.g., when using the Electric DB collection these options
      should match the database's collation settings.

#### Inherited from

```ts
Omit.defaultStringCollation
```

***

### getKey()

```ts
getKey: (item) => TKey;
```

Defined in: [packages/db/src/types.ts:463](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L463)

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

#### Inherited from

```ts
Omit.getKey
```

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:452](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L452)

#### Inherited from

[`BaseCollectionConfig`](BaseCollectionConfig.md).[`id`](BaseCollectionConfig.md#id)

***

### initialData?

```ts
optional initialData: T[];
```

Defined in: [packages/db/src/local-only.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts#L34)

Optional initial data to populate the collection with on creation
This data will be applied during the initial sync process

***

### onDelete?

```ts
optional onDelete: DeleteMutationFn<T, TKey, LocalOnlyCollectionUtils, any>;
```

Defined in: [packages/db/src/types.ts:652](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L652)

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

#### Inherited from

```ts
Omit.onDelete
```

***

### onInsert?

```ts
optional onInsert: InsertMutationFn<T, TKey, LocalOnlyCollectionUtils, any>;
```

Defined in: [packages/db/src/types.ts:565](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L565)

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

#### Inherited from

```ts
Omit.onInsert
```

***

### onUpdate?

```ts
optional onUpdate: UpdateMutationFn<T, TKey, LocalOnlyCollectionUtils, any>;
```

Defined in: [packages/db/src/types.ts:609](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L609)

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

#### Inherited from

```ts
Omit.onUpdate
```

***

### schema?

```ts
optional schema: TSchema;
```

Defined in: [packages/db/src/types.ts:453](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L453)

#### Inherited from

```ts
Omit.schema
```

***

### syncMode?

```ts
optional syncMode: SyncMode;
```

Defined in: [packages/db/src/types.ts:523](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L523)

The mode of sync to use for the collection.

#### Default

`eager`

#### Description

- `eager`: syncs all data immediately on preload
- `on-demand`: syncs data in incremental snapshots when the collection is queried
The exact implementation of the sync mode is up to the sync implementation.

#### Inherited from

[`BaseCollectionConfig`](BaseCollectionConfig.md).[`syncMode`](BaseCollectionConfig.md#syncmode)

***

### utils?

```ts
optional utils: LocalOnlyCollectionUtils;
```

Defined in: [packages/db/src/types.ts:662](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L662)

#### Inherited from

```ts
Omit.utils
```
