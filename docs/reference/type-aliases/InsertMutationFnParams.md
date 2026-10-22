---
id: InsertMutationFnParams
title: InsertMutationFnParams
---

```ts
type InsertMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:692](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L692)

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

Defined in: [packages/db/src/types.ts:702](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L702)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "insert", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:697](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L697)
