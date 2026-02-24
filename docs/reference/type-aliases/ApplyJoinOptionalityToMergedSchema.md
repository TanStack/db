---
id: ApplyJoinOptionalityToMergedSchema
title: ApplyJoinOptionalityToMergedSchema
---

# Type Alias: ApplyJoinOptionalityToMergedSchema\<TExistingSchema, TNewSchema, TJoinType, TFromSourceName\>

```ts
type ApplyJoinOptionalityToMergedSchema<TExistingSchema, TNewSchema, TJoinType, TFromSourceName> = { [K in keyof TExistingSchema]: K extends TFromSourceName ? TJoinType extends "right" | "full" ? TExistingSchema[K] | undefined : TExistingSchema[K] : TExistingSchema[K] } & { [K in keyof TNewSchema]: TJoinType extends "left" | "full" ? TNewSchema[K] | undefined : TNewSchema[K] };
```

Defined in: [packages/db/src/query/builder/types.ts:622](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L622)

ApplyJoinOptionalityToMergedSchema - Applies optionality rules when merging schemas

This type implements the SQL join optionality semantics:

**For Existing Tables**:
- `RIGHT JOIN` or `FULL JOIN`: Main table (from fromSourceName) becomes optional
- Other join types: Existing tables keep their current optionality
- Previously joined tables: Keep their already-applied optionality

**For New Tables**:
- `LEFT JOIN` or `FULL JOIN`: New table becomes optional
- `INNER JOIN` or `RIGHT JOIN`: New table remains required

**Examples**:
```sql
FROM users LEFT JOIN orders  -- orders becomes optional
FROM users RIGHT JOIN orders -- users becomes optional
FROM users FULL JOIN orders  -- both become optional
FROM users INNER JOIN orders -- both remain required
```

The intersection (&) ensures both existing and new schemas are merged
into a single type while preserving all table references.

## Type Parameters

### TExistingSchema

`TExistingSchema` *extends* [`ContextSchema`](ContextSchema.md)

### TNewSchema

`TNewSchema` *extends* [`ContextSchema`](ContextSchema.md)

### TJoinType

`TJoinType` *extends* `"inner"` \| `"left"` \| `"right"` \| `"full"` \| `"outer"` \| `"cross"`

### TFromSourceName

`TFromSourceName` *extends* `string`
