---
id: InsertMutationFnParams
title: InsertMutationFnParams
---

```ts
type InsertMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:655](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L655)

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

Defined in: [packages/db/src/types.ts:665](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L665)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "insert", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:660](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L660)
