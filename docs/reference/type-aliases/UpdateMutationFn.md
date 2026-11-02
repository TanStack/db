---
id: UpdateMutationFn
title: UpdateMutationFn
---

```ts
type UpdateMutationFn<T, TKey, TUtils> = (params) => Promise<void>;
```

Defined in: [packages/db/src/types.ts:768](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L768)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](UtilsRecord.md) = [`UtilsRecord`](UtilsRecord.md)

## Parameters

### params

[`UpdateMutationFnParams`](UpdateMutationFnParams.md)\<`T`, `TKey`, `TUtils`\>

## Returns

`Promise`\<`void`\>
