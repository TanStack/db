---
id: LocalStorageCollectionUtils
title: LocalStorageCollectionUtils
---

Defined in: [packages/db/src/local-storage.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L156)

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

Defined in: [packages/db/src/local-storage.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L179)

Accepts this Collection's manual mutations in write order and persists
them to localStorage. Call it inside the transaction's mutationFn. The
transaction's persistence receipt waits for this work even if the caller
does not await the returned Promise. Await it when later mutationFn work
depends on the storage write.

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

Defined in: [packages/db/src/local-storage.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L157)

***

### getStorageSize

```ts
getStorageSize: GetStorageSizeFn;
```

Defined in: [packages/db/src/local-storage.ts:158](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L158)
