---
id: DeleteMutationFn
title: DeleteMutationFn
---

```ts
type DeleteMutationFn<T, TKey, TUtils> = (params) => Promise<void>;
```

Defined in: [packages/db/src/types.ts:774](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L774)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](UtilsRecord.md) = [`UtilsRecord`](UtilsRecord.md)

## Parameters

### params

[`DeleteMutationFnParams`](DeleteMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`void`\>
