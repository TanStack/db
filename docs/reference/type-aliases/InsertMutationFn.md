---
id: InsertMutationFn
title: InsertMutationFn
---

# Type Alias: InsertMutationFn()\<T, TKey, TUtils, TReturn\>

```ts
type InsertMutationFn<T, TKey, TUtils, TReturn> = (params) => Promise<TReturn>;
```

Defined in: packages/db/src/types.ts:335

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](../UtilsRecord.md) = [`UtilsRecord`](../UtilsRecord.md)

### TReturn

`TReturn` = `any`

## Parameters

### params

[`InsertMutationFnParams`](../InsertMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`TReturn`\>
