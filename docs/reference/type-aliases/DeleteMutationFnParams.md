---
id: DeleteMutationFnParams
title: DeleteMutationFnParams
---

```ts
type DeleteMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:646](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L646)

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

Defined in: [packages/db/src/types.ts:656](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L656)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "delete", Collection<T, TKey, TUtils>>;
```

Defined in: [packages/db/src/types.ts:651](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L651)
