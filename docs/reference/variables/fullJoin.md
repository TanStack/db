---
id: fullJoin
title: fullJoin
---

```ts
const fullJoin: <TContext, TSource>(source, on) => JoinOperator<TContext, TSource, "full">;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L55)

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

[`JoinOperator`](../interfaces/JoinOperator.md)\<`TContext`, `TSource`, `"full"`\>
