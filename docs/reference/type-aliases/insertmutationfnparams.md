---
id: InsertMutationFnParams
title: InsertMutationFnParams
---

# Type Alias: InsertMutationFnParams\<T, TKey, TUtils\>

```ts
type InsertMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L318)

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

Defined in: [packages/db/src/types.ts:324](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L324)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "insert">;
```

Defined in: [packages/db/src/types.ts:323](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L323)
