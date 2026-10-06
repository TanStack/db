---
id: InsertMutationFnParams
title: InsertMutationFnParams
---

```ts
type InsertMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:628](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L628)

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

Defined in: [packages/db/src/types.ts:638](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L638)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "insert", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:633](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L633)
