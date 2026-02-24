---
id: InsertMutationFnParams
title: InsertMutationFnParams
---

# Type Alias: InsertMutationFnParams\<T, TKey, TUtils\>

```ts
type InsertMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:432](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L432)

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

Defined in: [packages/db/src/types.ts:438](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L438)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "insert">;
```

Defined in: [packages/db/src/types.ts:437](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L437)
