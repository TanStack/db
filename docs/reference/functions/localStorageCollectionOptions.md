---
id: localStorageCollectionOptions
title: localStorageCollectionOptions
---

# Function: localStorageCollectionOptions()

## Call Signature

```ts
function localStorageCollectionOptions<T, TKey>(config): CollectionConfig<InferSchemaOutput<T>, TKey, T, UtilsRecord> & object;
```

Defined in: packages/db/src/local-storage.ts:279

Creates localStorage collection options for use with a standard Collection

This function creates a collection that persists data to localStorage/sessionStorage
and synchronizes changes across browser tabs using storage events.

**Fallback Behavior:**

When localStorage is not available (e.g., in server-side rendering environments),
this function automatically falls back to an in-memory storage implementation.
This prevents errors during module initialization and allows the collection to
work in any environment, though data will not persist across page reloads or
be shared across tabs when using the in-memory fallback.

**Using with Manual Transactions:**

For manual transactions, you must call `utils.acceptMutations()` in your transaction's `mutationFn`
to persist changes made during `tx.mutate()`. This is necessary because local-storage collections
don't participate in the standard mutation handler flow for manual transactions.

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### Parameters

#### config

[`LocalStorageCollectionConfig`](../../interfaces/LocalStorageCollectionConfig.md)\<[`InferSchemaOutput`](../../type-aliases/InferSchemaOutput.md)\<`T`\>, `T`, `TKey`\> & `object`

Configuration options for the localStorage collection

### Returns

[`CollectionConfig`](../../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, [`UtilsRecord`](../../type-aliases/UtilsRecord.md)\> & `object`

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
    localSettings.utils.acceptMutations(transaction)
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
function localStorageCollectionOptions<T, TKey>(config): CollectionConfig<T, TKey, never, UtilsRecord> & object;
```

Defined in: packages/db/src/local-storage.ts:294

Creates localStorage collection options for use with a standard Collection

This function creates a collection that persists data to localStorage/sessionStorage
and synchronizes changes across browser tabs using storage events.

**Fallback Behavior:**

When localStorage is not available (e.g., in server-side rendering environments),
this function automatically falls back to an in-memory storage implementation.
This prevents errors during module initialization and allows the collection to
work in any environment, though data will not persist across page reloads or
be shared across tabs when using the in-memory fallback.

**Using with Manual Transactions:**

For manual transactions, you must call `utils.acceptMutations()` in your transaction's `mutationFn`
to persist changes made during `tx.mutate()`. This is necessary because local-storage collections
don't participate in the standard mutation handler flow for manual transactions.

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### Parameters

#### config

[`LocalStorageCollectionConfig`](../../interfaces/LocalStorageCollectionConfig.md)\<`T`, `never`, `TKey`\> & `object`

Configuration options for the localStorage collection

### Returns

[`CollectionConfig`](../../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, [`UtilsRecord`](../../type-aliases/UtilsRecord.md)\> & `object`

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
    localSettings.utils.acceptMutations(transaction)
  }
})

tx.mutate(() => {
  localSettings.insert({ id: 'theme', value: 'dark' })
  apiCollection.insert({ id: 2, data: 'profile data' })
})

await tx.commit()
```
