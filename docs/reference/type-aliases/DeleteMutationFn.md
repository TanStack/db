---
id: DeleteMutationFn
title: DeleteMutationFn
---

```ts
type DeleteMutationFn<T, TKey, TUtils, TReturn> = (params) => Promise<TReturn>;
```

Defined in: [packages/db/src/types.ts:681](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L681)

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

[`DeleteMutationFnParams`](DeleteMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`TReturn`\>
