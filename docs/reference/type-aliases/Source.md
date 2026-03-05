---
id: Source
title: Source
---

# Type Alias: Source

```ts
type Source = object;
```

Defined in: [packages/db/src/query/builder/types.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L75)

Source - Input definition for query builder `from()` clause

Maps table aliases to either:
- `CollectionImpl`: A database collection/table
- `QueryBuilder`: A subquery that can be used as a table

Example: `{ users: usersCollection, orders: ordersCollection }`

## Index Signature

```ts
[alias: string]: 
  | CollectionImpl<any, any, {
}, StandardSchemaV1<unknown, unknown>, any>
| QueryBuilder<Context>
```
