---
id: innerJoin
title: innerJoin
---

```ts
const innerJoin: <TContext, TSource>(source, on) => JoinOperator<TContext, TSource, "inner">;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L54)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

## Parameters

### source

`TSource`

### on

[`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends CollectionOptionsIdentity\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? ResultValue\<TContext\> : never \}\[K\] \}\>\>

## Returns

[`JoinOperator`](../interfaces/JoinOperator.md)\<`TContext`, `TSource`, `"inner"`\>
