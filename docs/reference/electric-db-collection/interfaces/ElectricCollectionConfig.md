---
id: ElectricCollectionConfig
title: ElectricCollectionConfig
---

Defined in: [packages/electric-db-collection/src/electric.ts:342](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L342)

Configuration interface for Electric collection options

## Extends

- `Omit`\<`BaseCollectionConfig`\<`T`, `string` \| `number`, `TSchema`, [`ElectricCollectionUtils`](ElectricCollectionUtils.md)\<`T`\>\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"` \| `"syncMode"`\>

## Type Parameters

### T

`T` *extends* `Row`\<`unknown`\> = `Row`\<`unknown`\>

The type of items in the collection

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

The schema type for validation

## Properties

### \[ELECTRIC\_TEST\_HOOKS\]?

```ts
optional [ELECTRIC_TEST_HOOKS]: ElectricTestHooks;
```

Defined in: [packages/electric-db-collection/src/electric.ts:359](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L359)

Internal test hooks (for testing only)
Hidden via Symbol to prevent accidental usage in production

***

### onDelete()?

```ts
optional onDelete: (params) => Promise<MatchingStrategy>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:545](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L545)

Optional asynchronous handler function called before a delete operation

**IMPORTANT - Electric Synchronization:**
This handler **must not resolve** until synchronization is confirmed.
Await one of these synchronization utilities before the handler completes:
1. `await collection.utils.awaitTxId(txid)` (recommended for most cases)
2. `await collection.utils.awaitMatch(fn)` for custom matching logic

Simply returning without waiting for sync will drop optimistic state too early, causing UI glitches.

#### Parameters

##### params

`DeleteMutationFnParams`\<`T`, `string` \| `number`, [`ElectricCollectionUtils`](ElectricCollectionUtils.md)\<`T`\>\>

Object containing transaction and collection information

#### Returns

`Promise`\<`MatchingStrategy`\>

Promise that should resolve after synchronization is complete

**Deprecation notice:** Returning `{ txid }` from handlers is deprecated and will be removed in v1.0.
Use `await collection.utils.awaitTxId(txid)` within the handler instead.

#### Examples

```ts
// Recommended: Wait for txid to sync
onDelete: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  const result = await api.todos.delete({
    id: mutation.original.id
  })
  // Wait for txid to sync before handler completes
  await collection.utils.awaitTxId(result.txid)
}
```

```ts
// Alternative: Use awaitMatch utility for custom matching logic
onDelete: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  await api.todos.delete({ id: mutation.original.id })
  // Wait for specific change to appear in sync stream
  await collection.utils.awaitMatch(
    (message) => isChangeMessage(message) &&
                 message.headers.operation === 'delete' &&
                 message.value.id === mutation.original.id
  )
}
```

***

### onInsert()?

```ts
optional onInsert: (params) => Promise<MatchingStrategy>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:446](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L446)

Optional asynchronous handler function called before an insert operation

**IMPORTANT - Electric Synchronization:**
This handler **must not resolve** until synchronization is confirmed.
Await one of these synchronization utilities before the handler completes:
1. `await collection.utils.awaitTxId(txid)` (recommended for most cases)
2. `await collection.utils.awaitMatch(fn)` for custom matching logic

Simply returning without waiting for sync will drop optimistic state too early, causing UI glitches.

#### Parameters

##### params

`InsertMutationFnParams`\<`T`, `string` \| `number`, [`ElectricCollectionUtils`](ElectricCollectionUtils.md)\<`T`\>\>

Object containing transaction and collection information

#### Returns

`Promise`\<`MatchingStrategy`\>

Promise that should resolve after synchronization is complete

**Deprecation notice:** Returning `{ txid }` from handlers is deprecated and will be removed in v1.0.
Use `await collection.utils.awaitTxId(txid)` within the handler instead.

#### Examples

```ts
// Recommended: Wait for txid to sync
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  const result = await api.todos.create({
    data: newItem
  })
  // Wait for txid to sync before handler completes
  await collection.utils.awaitTxId(result.txid)
}
```

```ts
// Insert handler with custom timeout
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  const result = await api.todos.create({
    data: newItem
  })
  // Wait up to 10 seconds for txid
  await collection.utils.awaitTxId(result.txid, 10000)
}
```

```ts
// Insert handler with timeout error handling
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  const result = await api.todos.create({
    data: newItem
  })

  try {
    await collection.utils.awaitTxId(result.txid, 5000)
  } catch (error) {
    // Decide sync timeout policy:
    // - Throw to rollback optimistic state
    // - Catch to keep optimistic state (eventual consistency)
    // - Schedule background retry
    console.warn('Sync timeout, keeping optimistic state:', error)
    // Don't throw - allow optimistic state to persist
  }
}
```

```ts
// Insert handler with multiple items
onInsert: async ({ transaction, collection }) => {
  const items = transaction.mutations.map(m => m.modified)
  const results = await Promise.all(
    items.map(item => api.todos.create({ data: item }))
  )
  // Wait for all txids to sync
  await Promise.all(
    results.map(r => collection.utils.awaitTxId(r.txid))
  )
}
```

```ts
// Alternative: Use awaitMatch utility for custom matching logic
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create({ data: newItem })
  // Wait for specific change to appear in sync stream
  await collection.utils.awaitMatch(
    (message) => isChangeMessage(message) &&
                 message.headers.operation === 'insert' &&
                 message.value.name === newItem.name
  )
}
```

***

### onUpdate()?

```ts
optional onUpdate: (params) => Promise<MatchingStrategy>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:496](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L496)

Optional asynchronous handler function called before an update operation

**IMPORTANT - Electric Synchronization:**
This handler **must not resolve** until synchronization is confirmed.
Await one of these synchronization utilities before the handler completes:
1. `await collection.utils.awaitTxId(txid)` (recommended for most cases)
2. `await collection.utils.awaitMatch(fn)` for custom matching logic

Simply returning without waiting for sync will drop optimistic state too early, causing UI glitches.

#### Parameters

##### params

`UpdateMutationFnParams`\<`T`, `string` \| `number`, [`ElectricCollectionUtils`](ElectricCollectionUtils.md)\<`T`\>\>

Object containing transaction and collection information

#### Returns

`Promise`\<`MatchingStrategy`\>

Promise that should resolve after synchronization is complete

**Deprecation notice:** Returning `{ txid }` from handlers is deprecated and will be removed in v1.0.
Use `await collection.utils.awaitTxId(txid)` within the handler instead.

#### Examples

```ts
// Recommended: Wait for txid to sync
onUpdate: async ({ transaction, collection }) => {
  const { original, changes } = transaction.mutations[0]
  const result = await api.todos.update({
    where: { id: original.id },
    data: changes
  })
  // Wait for txid to sync before handler completes
  await collection.utils.awaitTxId(result.txid)
}
```

```ts
// Alternative: Use awaitMatch utility for custom matching logic
onUpdate: async ({ transaction, collection }) => {
  const { original, changes } = transaction.mutations[0]
  await api.todos.update({ where: { id: original.id }, data: changes })
  // Wait for specific change to appear in sync stream
  await collection.utils.awaitMatch(
    (message) => isChangeMessage(message) &&
                 message.headers.operation === 'update' &&
                 message.value.id === original.id
  )
}
```

***

### shapeOptions

```ts
shapeOptions: ShapeStreamOptions<GetExtensions<T>>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:352](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L352)

Configuration options for the ElectricSQL ShapeStream

***

### syncMode?

```ts
optional syncMode: ElectricSyncMode;
```

Defined in: [packages/electric-db-collection/src/electric.ts:353](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L353)
