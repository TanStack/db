---
id: LocalStorageCollectionUtils
title: LocalStorageCollectionUtils
---

Defined in: [packages/db/src/local-storage.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L102)

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
acceptMutations: (transaction) => Promise<void>;
```

Defined in: [packages/db/src/local-storage.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L122)

Accepts mutations from a transaction that belong to this collection and persists them to localStorage.
Call this in your transaction's mutationFn. Its persistence receipt follows the storage write even
if the returned Promise is not awaited. Await it when later mutationFn work depends on the write.

#### Parameters

##### transaction

The transaction containing mutations to accept

###### mutations

[`PendingMutation`](PendingMutation.md)\<`Record`\<`string`, `unknown`\>, [`OperationType`](../type-aliases/OperationType.md), [`Collection`](Collection.md)\<`Record`\<`string`, `unknown`\>, `any`, `any`, `any`, `any`\>\>[]

#### Returns

`Promise`\<`void`\>

#### Example

```ts
const localSettings = createCollection(localStorageCollectionOptions({...}))

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Make API call first
    await api.save(...)
    // Then persist local-storage mutations after success
    await localSettings.utils.acceptMutations(transaction)
  }
})
```

***

### clearStorage

```ts
clearStorage: ClearStorageFn;
```

Defined in: [packages/db/src/local-storage.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L103)

***

### getStorageSize

```ts
getStorageSize: GetStorageSizeFn;
```

Defined in: [packages/db/src/local-storage.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L104)
