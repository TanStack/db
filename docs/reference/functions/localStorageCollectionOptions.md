---
id: localStorageCollectionOptions
title: localStorageCollectionOptions
---

## Call Signature

```ts
function localStorageCollectionOptions<T, TKey>(config): CollectionConfig<InferSchemaOutput<T>, TKey, T, LocalStorageCollectionUtils> & object;
```

Defined in: [packages/db/src/local-storage.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L318)

Creates localStorage collection options for use with a standard Collection

This function creates a collection that persists data to localStorage/sessionStorage
and synchronizes changes across browser tabs using storage events.
Create fresh options for each direct `createCollection()` call. One options
object contains state owned by one Collection and cannot be reused.

**Fallback Behavior:**

When localStorage is not available (e.g., in server-side rendering environments),
this function automatically falls back to an in-memory storage implementation.
This prevents errors during module initialization and allows the collection to
work in any environment, though data will not persist across page reloads or
be shared across tabs when using the in-memory fallback.

**Using with Manual Transactions:**

For manual transactions, call `utils.acceptMutations()` in your transaction's `mutationFn`
to persist changes made during `tx.mutate()`. The transaction receipt waits for that storage
write even if the call is not awaited. Await it when later work depends on the write.

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### Parameters

#### config

[`LocalStorageCollectionConfig`](../interfaces/LocalStorageCollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `T`, `TKey`\> & `object`

Configuration options for the localStorage collection

### Returns

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, [`LocalStorageCollectionUtils`](../interfaces/LocalStorageCollectionUtils.md)\> & `object`

Collection options with utilities including clearStorage, getStorageSize, and acceptMutations

### Examples

```ts
// Basic localStorage collection
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    getKey: (item) => item.id,
  })
)
```

```ts
// localStorage collection with custom storage
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    storage: window.sessionStorage, // Use sessionStorage instead
    getKey: (item) => item.id,
  })
)
```

```ts
// localStorage collection with mutation handlers
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      console.log('Item inserted:', transaction.mutations[0].modified)
    },
  })
)
```

```ts
// Using with manual transactions
const localSettings = createCollection(
  localStorageCollectionOptions({
    storageKey: 'user-settings',
    getKey: (item) => item.id,
  })
)

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Use settings data in API call
    const settingsMutations = transaction.mutations.filter(m => m.collection === localSettings)
    await api.updateUserProfile({ settings: settingsMutations[0]?.modified })

    // Persist local-storage mutations after API success
    await localSettings.utils.acceptMutations(transaction)
  }
})

tx.mutate(() => {
  localSettings.insert({ id: 'theme', value: 'dark' })
  apiCollection.insert({ id: 2, data: 'profile data' })
})

await tx.commit()
```

## Call Signature

```ts
function localStorageCollectionOptions<T, TKey>(config): CollectionConfig<T, TKey, never, LocalStorageCollectionUtils> & object;
```

Defined in: [packages/db/src/local-storage.ts:338](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L338)

Creates localStorage collection options for use with a standard Collection

This function creates a collection that persists data to localStorage/sessionStorage
and synchronizes changes across browser tabs using storage events.
Create fresh options for each direct `createCollection()` call. One options
object contains state owned by one Collection and cannot be reused.

**Fallback Behavior:**

When localStorage is not available (e.g., in server-side rendering environments),
this function automatically falls back to an in-memory storage implementation.
This prevents errors during module initialization and allows the collection to
work in any environment, though data will not persist across page reloads or
be shared across tabs when using the in-memory fallback.

**Using with Manual Transactions:**

For manual transactions, call `utils.acceptMutations()` in your transaction's `mutationFn`
to persist changes made during `tx.mutate()`. The transaction receipt waits for that storage
write even if the call is not awaited. Await it when later work depends on the write.

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### Parameters

#### config

[`LocalStorageCollectionConfig`](../interfaces/LocalStorageCollectionConfig.md)\<`T`, `never`, `TKey`\> & `object`

Configuration options for the localStorage collection

### Returns

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, [`LocalStorageCollectionUtils`](../interfaces/LocalStorageCollectionUtils.md)\> & `object`

Collection options with utilities including clearStorage, getStorageSize, and acceptMutations

### Examples

```ts
// Basic localStorage collection
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    getKey: (item) => item.id,
  })
)
```

```ts
// localStorage collection with custom storage
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    storage: window.sessionStorage, // Use sessionStorage instead
    getKey: (item) => item.id,
  })
)
```

```ts
// localStorage collection with mutation handlers
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      console.log('Item inserted:', transaction.mutations[0].modified)
    },
  })
)
```

```ts
// Using with manual transactions
const localSettings = createCollection(
  localStorageCollectionOptions({
    storageKey: 'user-settings',
    getKey: (item) => item.id,
  })
)

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Use settings data in API call
    const settingsMutations = transaction.mutations.filter(m => m.collection === localSettings)
    await api.updateUserProfile({ settings: settingsMutations[0]?.modified })

    // Persist local-storage mutations after API success
    await localSettings.utils.acceptMutations(transaction)
  }
})

tx.mutate(() => {
  localSettings.insert({ id: 'theme', value: 'dark' })
  apiCollection.insert({ id: 2, data: 'profile data' })
})

await tx.commit()
```
