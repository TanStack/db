---
id: MutationFn
title: MutationFn
---

# Type Alias: MutationFn()\<T\>

```ts
type MutationFn<T> = (params) => Promise<any>;
```

Defined in: [packages/db/src/types.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L135)

Persists an optimistic transaction. Do not start or await collection or
live-query preloads here. Sync commits queue behind this function, so waiting
for preload work that needs one of those commits can deadlock the mutation.
Use the collection adapter's mutation acknowledgement helper instead.

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Parameters

### params

[`MutationFnParams`](MutationFnParams.md)\<`T`\>

## Returns

`Promise`\<`any`\>
