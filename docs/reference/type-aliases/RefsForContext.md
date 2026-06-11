---
id: RefsForContext
title: RefsForContext
---

# Type Alias: RefsForContext\<TContext\>

```ts
type RefsForContext<TContext> = { [K in keyof TContext["schema"]]: IsNonExactOptional<TContext["schema"][K]> extends true ? IsNonExactNullable<TContext["schema"][K]> extends true ? Ref<NonNullable<TContext["schema"][K]>, true> : Ref<NonUndefined<TContext["schema"][K]>, true> : IsNonExactNullable<TContext["schema"][K]> extends true ? Ref<NonNull<TContext["schema"][K]>, true> : Ref<TContext["schema"][K]> } & TContext["hasResult"] extends true ? object : object;
```

Defined in: [packages/db/src/query/builder/types.ts:502](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L502)

RefsForContext - Creates ref proxies for all tables/collections in a query context

This is the main entry point for creating ref objects in query builder callbacks.
For nullable join sides (left/right/full joins), it produces `Ref<T, true>` instead
of `Ref<T> | undefined`. This accurately reflects that the proxy object is always
present at build time (it's a truthy proxy that records property access paths),
while the `Nullable` flag ensures the result type correctly includes `| undefined`.

Examples:
- Required field: `Ref<User>` → user.name works, result is T
- Nullable join side: `Ref<User, true>` → user.name works, result is T | undefined

After `select()` is called, this type also includes `$selected` which provides access
to the SELECT result fields via `$selected.fieldName` syntax.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
