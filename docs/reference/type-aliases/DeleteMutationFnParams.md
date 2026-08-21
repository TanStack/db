---
id: DeleteMutationFnParams
title: DeleteMutationFnParams
---

# Type Alias: DeleteMutationFnParams\<T, TKey, TUtils\>

```ts
type DeleteMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:484](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L484)

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

Defined in: [packages/db/src/types.ts:490](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L490)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "delete">;
```

Defined in: [packages/db/src/types.ts:489](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L489)
