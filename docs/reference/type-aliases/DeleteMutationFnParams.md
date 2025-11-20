---
id: DeleteMutationFnParams
title: DeleteMutationFnParams
---

# Type Alias: DeleteMutationFnParams\<T, TKey, TUtils\>

```ts
type DeleteMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:376](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L376)

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

Defined in: [packages/db/src/types.ts:382](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L382)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "delete">;
```

Defined in: [packages/db/src/types.ts:381](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L381)
