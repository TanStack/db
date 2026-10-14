---
id: UpdateMutationFnParams
title: UpdateMutationFnParams
---

```ts
type UpdateMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:642](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L642)

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

Defined in: [packages/db/src/types.ts:652](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L652)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "update", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:647](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L647)
