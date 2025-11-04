---
id: TransactionWithMutations
title: TransactionWithMutations
---

# Type Alias: TransactionWithMutations\<T, TOperation\>

```ts
type TransactionWithMutations<T, TOperation> = Transaction<T> & object;
```

Defined in: [packages/db/src/types.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L108)

Utility type for a Transaction with at least one mutation
This is used internally by the Transaction.commit method

## Type Declaration

### mutations

```ts
mutations: NonEmptyArray<PendingMutation<T, TOperation>>;
```

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TOperation

`TOperation` *extends* [`OperationType`](../OperationType.md) = [`OperationType`](../OperationType.md)
