---
id: UpdateMutationFnParams
title: UpdateMutationFnParams
---

# Type Alias: UpdateMutationFnParams\<T, TKey, TUtils\>

```ts
type UpdateMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:417](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L417)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](UtilsRecord.md) = [`UtilsRecord`](UtilsRecord.md)

## Properties

### collection

```ts
collection: Collection<T, TKey, TUtils>;
```

Defined in: [packages/db/src/types.ts:423](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L423)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "update">;
```

Defined in: [packages/db/src/types.ts:422](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L422)
