---
id: LocalOnlyCollectionUtils
title: LocalOnlyCollectionUtils
---

# Interface: LocalOnlyCollectionUtils

Defined in: [packages/db/src/local-only.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts#L40)

Local-only collection utilities type

## Extends

- [`UtilsRecord`](../../type-aliases/UtilsRecord.md)

## Indexable

```ts
[key: string]: Fn
```

## Properties

### acceptMutations()

```ts
acceptMutations: (transaction) => void;
```

Defined in: [packages/db/src/local-only.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts#L58)

Accepts mutations from a transaction that belong to this collection and persists them.
This should be called in your transaction's mutationFn to persist local-only data.

#### Parameters

##### transaction

The transaction containing mutations to accept

###### mutations

[`PendingMutation`](../PendingMutation.md)\<`Record`\<`string`, `unknown`\>, [`OperationType`](../../type-aliases/OperationType.md), [`Collection`](../Collection.md)\<`Record`\<`string`, `unknown`\>, `any`, `any`, `any`, `any`\>\>[]

#### Returns

`void`

#### Example

```ts
const localData = createCollection(localOnlyCollectionOptions({...}))

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Make API call first
    await api.save(...)
    // Then persist local-only mutations after success
    localData.utils.acceptMutations(transaction)
  }
})
```
