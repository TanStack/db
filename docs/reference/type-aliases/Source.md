---
id: Source
title: Source
---

# Type Alias: Source

```ts
type Source = object;
```

Defined in: [packages/db/src/query/builder/types.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L92)

Source - Input definition for query builder `from()` and `unionAll()` clauses

Maps table aliases to either:
- `CollectionImpl`: A database collection/table
- `QueryBuilder`: A subquery that can be used as a table

Example: `{ users: usersCollection }`

## Index Signature

```ts
[alias: string]: 
  | QueryBuilder<any>
  | CollectionImpl<any, any, {
}, StandardSchemaV1<unknown, unknown>, any>
| CollectionOptionsIdentity<any, any, any, any, any>
```
