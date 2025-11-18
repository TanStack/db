---
id: DeleteMutationFnParams
title: DeleteMutationFnParams
---

# Type Alias: DeleteMutationFnParams\<T, TKey, TUtils\>

```ts
type DeleteMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:357](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L357)

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

Defined in: [packages/db/src/types.ts:363](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L363)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "delete">;
```

Defined in: [packages/db/src/types.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L362)
