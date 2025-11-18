---
id: DeleteMutationFn
title: DeleteMutationFn
---

# Type Alias: DeleteMutationFn()\<T, TKey, TUtils, TReturn\>

```ts
type DeleteMutationFn<T, TKey, TUtils, TReturn> = (params) => Promise<TReturn>;
```

Defined in: [packages/db/src/types.ts:380](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L380)

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

[`DeleteMutationFnParams`](../DeleteMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`TReturn`\>
