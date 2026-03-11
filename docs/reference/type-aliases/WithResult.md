---
id: WithResult
title: WithResult
---

# Type Alias: WithResult\<TContext, TResult\>

```ts
type WithResult<TContext, TResult> = Prettify<Omit<TContext, "result"> & object>;
```

Defined in: [packages/db/src/query/builder/types.ts:836](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L836)

WithResult - Updates a context with a new result type after select()

This utility type is used internally when the `select()` method is called
to update the context with the projected result type. It preserves all
other context properties while replacing the `result` field.

**Usage**:
When `select()` is called, the query builder uses this type to create
a new context where `result` contains the shape of the selected fields.

The double `Prettify` ensures both the overall context and the nested
result type display cleanly in IDEs.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TResult

`TResult`
