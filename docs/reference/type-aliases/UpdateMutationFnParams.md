---
id: UpdateMutationFnParams
title: UpdateMutationFnParams
---

```ts
type UpdateMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:620](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L620)

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

Defined in: [packages/db/src/types.ts:630](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L630)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "update", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:625](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L625)
