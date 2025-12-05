---
id: LocalStorageCollectionUtils
title: LocalStorageCollectionUtils
---

# Interface: LocalStorageCollectionUtils

Defined in: [packages/db/src/local-storage.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L100)

LocalStorage collection utilities type

## Extends

- [`UtilsRecord`](../type-aliases/UtilsRecord.md)

## Indexable

```ts
[key: string]: any
```

## Properties

### acceptMutations()

```ts
acceptMutations: (transaction) => void;
```

Defined in: [packages/db/src/local-storage.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L120)

Accepts mutations from a transaction that belong to this collection and persists them to localStorage.
This should be called in your transaction's mutationFn to persist local-storage data.

#### Parameters

##### transaction

The transaction containing mutations to accept

###### mutations

[`PendingMutation`](./PendingMutation.md)\<`Record`\<`string`, `unknown`\>, [`OperationType`](../type-aliases/OperationType.md), [`Collection`](./Collection.md)\<`Record`\<`string`, `unknown`\>, `any`, `any`, `any`, `any`\>\>[]

#### Returns

`void`

#### Example

```ts
const localSettings = createCollection(localStorageCollectionOptions({...}))

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Make API call first
    await api.save(...)
    // Then persist local-storage mutations after success
    localSettings.utils.acceptMutations(transaction)
  }
})
```

***

### clearStorage

```ts
clearStorage: ClearStorageFn;
```

Defined in: [packages/db/src/local-storage.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L101)

***

### getStorageSize

```ts
getStorageSize: GetStorageSizeFn;
```

Defined in: [packages/db/src/local-storage.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L102)
