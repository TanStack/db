---
id: UpdateMutationFnParams
title: UpdateMutationFnParams
---

# Type Alias: UpdateMutationFnParams\<T, TKey, TUtils\>

```ts
type UpdateMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:363](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L363)

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

Defined in: [packages/db/src/types.ts:369](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L369)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "update">;
```

Defined in: [packages/db/src/types.ts:368](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L368)
