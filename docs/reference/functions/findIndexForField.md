---
id: findIndexForField
title: findIndexForField
---

```ts
function findIndexForField<TKey>(
   collection, 
   fieldPath, 
   compareOptions?, 
   canUse?): IndexReader<TKey> | undefined;
```

Defined in: [packages/db/src/utils/index-optimization.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/utils/index-optimization.ts#L59)

Finds the first usable index matching a field path and comparison options.

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

### canUse?

(`index`) => `boolean`

## Returns

[`IndexReader`](../type-aliases/IndexReader.md)\<`TKey`\> \| `undefined`
