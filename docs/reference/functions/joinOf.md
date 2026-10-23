---
id: joinOf
title: joinOf
---

```ts
function joinOf<TJoinType, TSource, TContext>(
   type, 
   source, 
on): JoinOperator<TContext, TSource, TJoinType>;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L75)

A join whose type is chosen at run time.

## Type Parameters

### TJoinType

`TJoinType` *extends* [`JoinType`](../type-aliases/JoinType.md)

### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md) = `any`

## Parameters

### type

`TJoinType`

### source

`TSource`

### on

`JoinCondition`\<`TContext`, `TSource`\>

## Returns

[`JoinOperator`](../interfaces/JoinOperator.md)\<`TContext`, `TSource`, `TJoinType`\>
