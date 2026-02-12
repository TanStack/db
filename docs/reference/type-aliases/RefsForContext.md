---
id: RefsForContext
title: RefsForContext
---

# Type Alias: RefsForContext\<TContext\>

```ts
type RefsForContext<TContext> = { [K in keyof TContext["schema"]]: IsNonExactOptional<TContext["schema"][K]> extends true ? IsNonExactNullable<TContext["schema"][K]> extends true ? Ref<NonNullable<TContext["schema"][K]>> | undefined : Ref<NonUndefined<TContext["schema"][K]>> | undefined : IsNonExactNullable<TContext["schema"][K]> extends true ? Ref<NonNull<TContext["schema"][K]>> | null : Ref<TContext["schema"][K]> } & TContext["result"] extends object ? object : object;
```

Defined in: [packages/db/src/query/builder/types.ts:391](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L391)

RefProxyForContext - Creates ref proxies for all tables/collections in a query context

This is the main entry point for creating ref objects in query builder callbacks.
It handles optionality by placing undefined/null OUTSIDE the RefProxy to enable
JavaScript's optional chaining operator (?.):

Examples:
- Required field: `RefProxy<User>` → user.name works
- Optional field: `RefProxy<User> | undefined` → user?.name works
- Nullable field: `RefProxy<User> | null` → user?.name works
- Both optional and nullable: `RefProxy<User> | undefined` → user?.name works

The key insight is that `RefProxy<User | undefined>` would NOT allow `user?.name`
because the undefined is "inside" the proxy, but `RefProxy<User> | undefined`
does allow it because the undefined is "outside" the proxy.

The logic prioritizes optional chaining by always placing `undefined` outside when
a type is both optional and nullable (e.g., `string | null | undefined`).

After `select()` is called, this type also includes `$selected` which provides access
to the SELECT result fields via `$selected.fieldName` syntax.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
