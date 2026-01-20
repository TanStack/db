---
id: DeleteMutationFnParams
title: DeleteMutationFnParams
---

# Type Alias: DeleteMutationFnParams\<T, TKey, TUtils\>

```ts
type DeleteMutationFnParams<T, TKey, TUtils> = object;
```

Defined in: [packages/db/src/types.ts:440](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L440)

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

Defined in: [packages/db/src/types.ts:446](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L446)

***

### transaction

```ts
transaction: TransactionWithMutations<T, "delete">;
```

Defined in: [packages/db/src/types.ts:445](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L445)
