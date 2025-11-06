---
id: InferResultType
title: InferResultType
---

# Type Alias: InferResultType\<TContext\>

```ts
type InferResultType<TContext> = TContext extends SingleResult ? GetResult<TContext> | undefined : GetResult<TContext>[];
```

Defined in: packages/db/src/query/builder/types.ts:645

Utility type to infer the query result size (single row or an array)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../../interfaces/Context.md)
