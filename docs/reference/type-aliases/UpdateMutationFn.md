---
id: UpdateMutationFn
title: UpdateMutationFn
---

# Type Alias: UpdateMutationFn()\<T, TKey, TUtils, TReturn\>

```ts
type UpdateMutationFn<T, TKey, TUtils, TReturn> = (params) => Promise<TReturn>;
```

Defined in: [packages/db/src/types.ts:392](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L392)

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

[`UpdateMutationFnParams`](../UpdateMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`TReturn`\>
