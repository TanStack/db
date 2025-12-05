---
id: TransactionWithMutations
title: TransactionWithMutations
---

# Type Alias: TransactionWithMutations\<T, TOperation\>

```ts
type TransactionWithMutations<T, TOperation> = Omit<Transaction<T>, "mutations"> & object;
```

Defined in: [packages/db/src/types.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L139)

Utility type for a Transaction with at least one mutation
This is used internally by the Transaction.commit method

## Type Declaration

### mutations

```ts
mutations: NonEmptyArray<PendingMutation<T, TOperation>>;
```

We must omit the `mutations` property from `Transaction<T>` before intersecting
because TypeScript intersects property types when the same property appears on
both sides of an intersection.

Without `Omit`:
- `Transaction<T>` has `mutations: Array<PendingMutation<T>>`
- The intersection would create: `Array<PendingMutation<T>> & NonEmptyArray<PendingMutation<T, TOperation>>`
- When mapping over this array, TypeScript widens `TOperation` from the specific literal
  (e.g., `"delete"`) to the union `OperationType` (`"insert" | "update" | "delete"`)
- This causes `PendingMutation<T, OperationType>` to evaluate the conditional type
  `original: TOperation extends 'insert' ? {} : T` as `{} | T` instead of just `T`

With `Omit`:
- We remove `mutations` from `Transaction<T>` first
- Then add back `mutations: NonEmptyArray<PendingMutation<T, TOperation>>`
- TypeScript can properly narrow `TOperation` to the specific literal type
- This ensures `mutation.original` is correctly typed as `T` (not `{} | T`) when mapping

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TOperation

`TOperation` *extends* [`OperationType`](./OperationType.md) = [`OperationType`](./OperationType.md)
