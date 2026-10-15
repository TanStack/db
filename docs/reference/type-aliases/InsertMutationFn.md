---
id: InsertMutationFn
title: InsertMutationFn
---

```ts
type InsertMutationFn<T, TKey, TUtils> = (params) => Promise<void>;
```

Defined in: [packages/db/src/types.ts:680](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L680)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](UtilsRecord.md) = [`UtilsRecord`](UtilsRecord.md)

## Parameters

### params

[`InsertMutationFnParams`](InsertMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`void`\>
