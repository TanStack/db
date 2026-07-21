---
id: RefsForContext
title: RefsForContext
---

# Type Alias: RefsForContext\<TContext\>

```ts
type RefsForContext<TContext> = { [K in KeysOfUnion<RefsSchemaForContext<TContext>>]: IsNonExactOptional<ValueOfUnion<RefsSchemaForContext<TContext>, K>> extends true ? IsNonExactNullable<ValueOfUnion<RefsSchemaForContext<TContext>, K>> extends true ? RefForContextValue<NonNullable<ValueOfUnion<RefsSchemaForContext<TContext>, K>>, true> : RefForContextValue<NonUndefined<ValueOfUnion<RefsSchemaForContext<TContext>, K>>, true> : IsNonExactNullable<ValueOfUnion<RefsSchemaForContext<TContext>, K>> extends true ? RefForContextValue<NonNull<ValueOfUnion<RefsSchemaForContext<TContext>, K>>, true> : RefForContextValue<ValueOfUnion<RefsSchemaForContext<TContext>, K>> } & TContext["hasResult"] extends true ? object : object;
```

Defined in: [packages/db/src/query/builder/types.ts:677](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L677)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
