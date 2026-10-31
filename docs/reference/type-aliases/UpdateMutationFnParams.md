---
id: UpdateMutationFnParams
title: UpdateMutationFnParams
---

```ts
type UpdateMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:724](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L724)

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

Defined in: [packages/db/src/types.ts:734](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L734)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "update", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:729](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L729)
