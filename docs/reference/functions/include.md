---
id: include
title: include
---

```ts
function include<TContext>(query): IncludeWrapper<TContext>;
```

Defined in: [packages/db/src/query/builder/include-functions.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/include-functions.ts#L74)

Includes a correlated subquery as a live child Collection on each parent
row. Use `toArray()` or `materialize()` for inline values instead.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### query

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

## Returns

`IncludeWrapper`\<`TContext`\>

## Example

```ts
select(({ p }) => ({
  ...p,
  issues: include(
    q.from({ i: issues }).where(({ i }) => eq(i.projectId, p.id)),
  ),
}))
```
