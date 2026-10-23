---
id: InferResultType
title: InferResultType
---

```ts
type InferResultType<TContext> = TContext extends SingleResult ? GetResult<TContext> | undefined : GetResult<TContext>[];
```

Defined in: [packages/db/src/query/builder/types.ts:1090](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L1090)

Utility type to infer the query result size (single row or an array)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
