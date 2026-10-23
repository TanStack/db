---
id: JoinCondition
title: JoinCondition
---

```ts
type JoinCondition<TContext, TSource> = OperatorCallback<TContext, JoinOnCallback<MergeContextForJoinCallback<TContext, SchemaFromSource<TSource>>>>;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L46)

A join condition. `.join()` supplies the query's context. A reusable
operator built outside `.join()` passes it explicitly:
`leftJoin<{ post: typeof posts }, ContextFromSource<{ user: typeof users }>>(...)`.
Without it, the condition is untyped.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TSource

`TSource` *extends* [`Source`](Source.md)
