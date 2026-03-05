---
id: MergeContextWithJoinType
title: MergeContextWithJoinType
---

# Type Alias: MergeContextWithJoinType\<TContext, TNewSchema, TJoinType\>

```ts
type MergeContextWithJoinType<TContext, TNewSchema, TJoinType> = object & PreserveSingleResultFlag<TContext["singleResult"]>;
```

Defined in: packages/db/src/query/builder/types.ts:573

MergeContextWithJoinType - Creates a new context after a join operation

This is the core type that handles the complex logic of merging schemas
when tables are joined, applying the correct optionality based on join type.

**Key Responsibilities**:
1. **Schema Merging**: Combines existing schema with newly joined tables
2. **Optionality Logic**: Applies join-specific optionality rules:
   - `LEFT JOIN`: New table becomes optional
   - `RIGHT JOIN`: Existing tables become optional
   - `FULL JOIN`: Both existing and new become optional
   - `INNER JOIN`: No tables become optional
3. **State Tracking**: Updates hasJoins and joinTypes for future operations

**Context Evolution**:
- `baseSchema`: Unchanged (always the original `from()` tables)
- `schema`: Expanded with new tables and proper optionality
- `hasJoins`: Set to true
- `joinTypes`: Updated to track this join type
- `result`: Preserved from previous operations
- `singleResult`: Preserved only if already true (via PreserveSingleResultFlag)

## Type Declaration

### baseSchema

```ts
baseSchema: TContext["baseSchema"];
```

### fromSourceName

```ts
fromSourceName: TContext["fromSourceName"];
```

### hasJoins

```ts
hasJoins: true;
```

### joinTypes

```ts
joinTypes: TContext["joinTypes"] extends Record<string, any> ? TContext["joinTypes"] : object & { [K in keyof TNewSchema & string]: TJoinType };
```

### result

```ts
result: TContext["result"];
```

### schema

```ts
schema: ApplyJoinOptionalityToMergedSchema<TContext["schema"], TNewSchema, TJoinType, TContext["fromSourceName"]>;
```

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TNewSchema

`TNewSchema` *extends* [`ContextSchema`](ContextSchema.md)

### TJoinType

`TJoinType` *extends* `"inner"` \| `"left"` \| `"right"` \| `"full"` \| `"outer"` \| `"cross"`
