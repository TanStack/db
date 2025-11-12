---
id: UpdateMutationFnParams
title: UpdateMutationFnParams
---

# Type Alias: UpdateMutationFnParams\<T, TKey, TUtils\>

```ts
type UpdateMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:340](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L340)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](../UtilsRecord.md) = [`UtilsRecord`](../UtilsRecord.md)

## Properties

### collection

```ts
collection: Collection<T, TKey, TUtils>;
```

Defined in: [packages/db/src/types.ts:346](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L346)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "update">;
```

Defined in: [packages/db/src/types.ts:345](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L345)
