---
id: ResolveTransactionChanges
title: ResolveTransactionChanges
---

# Type Alias: ResolveTransactionChanges\<T, TOperation\>

```ts
type ResolveTransactionChanges<T, TOperation> = TOperation extends "delete" ? T : Partial<T>;
```

Defined in: packages/db/src/types.ts:80

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TOperation

`TOperation` *extends* [`OperationType`](OperationType.md) = [`OperationType`](OperationType.md)

## Remarks

`update` and `insert` are both represented as `Partial<T>`, but changes for `insert` could me made more precise by inferring the schema input type. In practice, this has almost 0 real world impact so it's not worth the added type complexity.

## See

https://github.com/TanStack/db/pull/209#issuecomment-3053001206
