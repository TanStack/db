---
id: findIndexForField
title: findIndexForField
---

# Function: findIndexForField()

```ts
function findIndexForField<TKey>(
   collection, 
   fieldPath, 
   compareOptions?): 
  | IndexInterface<TKey>
  | undefined;
```

Defined in: [packages/db/src/utils/index-optimization.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/utils/index-optimization.ts#L37)

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

  \| [`IndexInterface`](../interfaces/IndexInterface.md)\<`TKey`\>
  \| `undefined`
