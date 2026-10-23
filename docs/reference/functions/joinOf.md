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

Defined in: [packages/db/src/query/builder/join-operators.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L78)

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

[`OperatorCallback`](../type-aliases/OperatorCallback.md)\<`TContext`, [`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends CollectionOptionsIdentity\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? ResultValue\<TContext\> : never \}\[K\] \}\>\>\>

## Returns

[`JoinOperator`](../interfaces/JoinOperator.md)\<`TContext`, `TSource`, `TJoinType`\>
