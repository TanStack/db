---
id: findIndexForField
title: findIndexForField
---

# Function: findIndexForField()

```ts
function findIndexForField<TKey>(
   collection, 
   fieldPath, 
   compareOptions?): IndexReader<TKey> | undefined;
```

Defined in: [packages/db/src/utils/index-optimization.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/utils/index-optimization.ts#L45)

Finds an index that matches a given field path

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number`

## Parameters

### collection

[`CollectionLike`](../interfaces/CollectionLike.md)\<`any`, `TKey`\>

### fieldPath

`string`[]

### compareOptions?

`CompareOptions`

## Returns

[`IndexReader`](../type-aliases/IndexReader.md)\<`TKey`\> \| `undefined`
