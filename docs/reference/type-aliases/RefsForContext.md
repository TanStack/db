---
id: RefsForContext
title: RefsForContext
---

```ts
type RefsForContext<TContext> = { [K in Exclude<KeysOfUnion<RefsSchemaForContext<TContext>>, keyof JoinedRefsForContext<TContext> | keyof BranchUnionResultRefs<TContext>>]: RefForContextSchemaValue<ValueOfUnion<RefsSchemaForContext<TContext>, K>, IsNullableContextKey<TContext, K>> } & TContext["hasResult"] extends true ? object : object & BranchUnionResultRefs<TContext> & JoinedRefsForContext<TContext>;
```

Defined in: [packages/db/src/query/builder/types.ts:769](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L769)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
