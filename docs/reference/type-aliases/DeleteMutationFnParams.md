---
id: DeleteMutationFnParams
title: DeleteMutationFnParams
---

```ts
type DeleteMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:749](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L749)

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

Defined in: [packages/db/src/types.ts:759](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L759)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "delete", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:754](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L754)
