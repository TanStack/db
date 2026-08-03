---
id: materialize
title: materialize
---

# Function: materialize()

```ts
function materialize<TContext>(query): MaterializeWrapper<GetRawResult<TContext>, TContext extends SingleResult ? true : false>;
```

Defined in: [packages/db/src/query/builder/functions.ts:848](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L848)

Materialize an includes subquery into a plain value on the parent row.

- For multi-row subqueries, the parent receives an `Array<T>` snapshot
  (equivalent to `toArray()`).
- For `findOne()` subqueries, the parent receives a single `T | undefined`
  value — `undefined` when no child matches.

The snapshot updates reactively: parent rows re-emit when the underlying
children change.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### query

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

## Returns

`MaterializeWrapper`\<`GetRawResult`\<`TContext`\>, `TContext` *extends* [`SingleResult`](../type-aliases/SingleResult.md) ? `true` : `false`\>

## Example

```ts
// Multi-row: produces Array<Issue> on each project
select(({ p }) => ({
  ...p,
  issues: materialize(
    q.from({ i: issues }).where(({ i }) => eq(i.projectId, p.id)),
  ),
}))

// Singleton: produces Author | undefined on each post
select(({ p }) => ({
  ...p,
  author: materialize(
    q.from({ a: authors }).where(({ a }) => eq(a.id, p.authorId)).findOne(),
  ),
}))
```
