---
id: InsertMutationFn
title: InsertMutationFn
---

```ts
type InsertMutationFn<T, TKey, TUtils, TReturn> = (params) => Promise<TReturn>;
```

Defined in: [packages/db/src/types.ts:661](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L661)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](UtilsRecord.md) = [`UtilsRecord`](UtilsRecord.md)

### TReturn

`TReturn` = `any`

DEPRECATED: Return values are kept for backward compatibility and will be removed in v1.0.

## Parameters

### params

[`InsertMutationFnParams`](InsertMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`TReturn`\>
