---
id: localOnlyCollectionOptions
title: localOnlyCollectionOptions
---

# Function: localOnlyCollectionOptions()

## Call Signature

```ts
function localOnlyCollectionOptions<T, TKey>(config): CollectionConfig<InferSchemaOutput<T>, TKey, T, LocalOnlyCollectionUtils> & object & object;
```

Defined in: [packages/db/src/local-only.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts#L149)

Creates Local-only collection options for use with a standard Collection

This is an in-memory collection that doesn't sync with external sources but uses a loopback sync config
that immediately "syncs" all optimistic changes to the collection, making them permanent.
Perfect for local-only data that doesn't need persistence or external synchronization.

**Using with Manual Transactions:**

For manual transactions, you must call `utils.acceptMutations()` in your transaction's `mutationFn`
to persist changes made during `tx.mutate()`. This is necessary because local-only collections
don't participate in the standard mutation handler flow for manual transactions.

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

The schema type if a schema is provided, otherwise the type of items in the collection

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key returned by getKey

### Parameters

#### config

[`LocalOnlyCollectionConfig`](../interfaces/LocalOnlyCollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `T`, `TKey`\> & `object`

Configuration options for the Local-only collection

### Returns

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, [`LocalOnlyCollectionUtils`](../interfaces/LocalOnlyCollectionUtils.md)\> & `object` & `object`

Collection options with utilities including acceptMutations

### Examples

```ts
// Basic local-only collection
const collection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
  })
)
```

```ts
// Local-only collection with initial data
const collection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
    initialData: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ],
  })
)
```

```ts
// Local-only collection with mutation handlers
const collection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      console.log('Item inserted:', transaction.mutations[0].modified)
      // Custom logic after insert
    },
  })
)
```

```ts
// Using with manual transactions
const localData = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
  })
)

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Use local data in API call
    const localMutations = transaction.mutations.filter(m => m.collection === localData)
    await api.save({ metadata: localMutations[0]?.modified })

    // Persist local-only mutations after API success
    localData.utils.acceptMutations(transaction)
  }
})

tx.mutate(() => {
  localData.insert({ id: 1, data: 'metadata' })
  apiCollection.insert({ id: 2, data: 'main data' })
})

await tx.commit()
```

## Call Signature

```ts
function localOnlyCollectionOptions<T, TKey>(config): CollectionConfig<T, TKey, never, LocalOnlyCollectionUtils> & object & object;
```

Defined in: [packages/db/src/local-only.ts:162](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts#L162)

Creates Local-only collection options for use with a standard Collection

This is an in-memory collection that doesn't sync with external sources but uses a loopback sync config
that immediately "syncs" all optimistic changes to the collection, making them permanent.
Perfect for local-only data that doesn't need persistence or external synchronization.

**Using with Manual Transactions:**

For manual transactions, you must call `utils.acceptMutations()` in your transaction's `mutationFn`
to persist changes made during `tx.mutate()`. This is necessary because local-only collections
don't participate in the standard mutation handler flow for manual transactions.

### Type Parameters

#### T

`T` *extends* `object`

The schema type if a schema is provided, otherwise the type of items in the collection

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key returned by getKey

### Parameters

#### config

[`LocalOnlyCollectionConfig`](../interfaces/LocalOnlyCollectionConfig.md)\<`T`, `never`, `TKey`\> & `object`

Configuration options for the Local-only collection

### Returns

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, [`LocalOnlyCollectionUtils`](../interfaces/LocalOnlyCollectionUtils.md)\> & `object` & `object`

Collection options with utilities including acceptMutations

### Examples

```ts
// Basic local-only collection
const collection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
  })
)
```

```ts
// Local-only collection with initial data
const collection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
    initialData: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ],
  })
)
```

```ts
// Local-only collection with mutation handlers
const collection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      console.log('Item inserted:', transaction.mutations[0].modified)
      // Custom logic after insert
    },
  })
)
```

```ts
// Using with manual transactions
const localData = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
  })
)

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Use local data in API call
    const localMutations = transaction.mutations.filter(m => m.collection === localData)
    await api.save({ metadata: localMutations[0]?.modified })

    // Persist local-only mutations after API success
    localData.utils.acceptMutations(transaction)
  }
})

tx.mutate(() => {
  localData.insert({ id: 1, data: 'metadata' })
  apiCollection.insert({ id: 2, data: 'main data' })
})

await tx.commit()
```
