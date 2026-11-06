---
id: WithResult
title: WithResult
---

```ts
type WithResult<TContext, TResult, TSelection> = Prettify<Omit<TContext, "result" | "hasResult" | "hasAggregate"> & Pick<TContext, "baseSchema" | "schema" | "fromSourceName"> & object>;
```

Defined in: [packages/db/src/query/builder/types.ts:1470](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L1470)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TResult

`TResult`

### TSelection

`TSelection` = `unknown`
