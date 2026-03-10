---
id: FunctionalHavingRow
title: FunctionalHavingRow
---

# Type Alias: FunctionalHavingRow\<TContext\>

```ts
type FunctionalHavingRow<TContext> = TContext["schema"] & TContext["result"] extends object ? object : object;
```

Defined in: [packages/db/src/query/builder/types.ts:365](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L365)

FunctionalHavingRow - Type for the row parameter in functional having callbacks

Functional having callbacks receive a namespaced row that includes:
- Table data from the schema (when available)
- $selected: The SELECT result fields (when select() has been called)

After `select()` is called, this type includes `$selected` which provides access
to the SELECT result fields via `$selected.fieldName` syntax.

Note: When used with GROUP BY, functional having receives `{ $selected: ... }` with the
aggregated SELECT results. When used without GROUP BY, it receives the full namespaced row
which includes both table data and `$selected`.

Example: `({ $selected }) => $selected.sessionCount > 2`
Example (no GROUP BY): `(row) => row.user.salary > 70000 && row.$selected.user_count > 2`

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
