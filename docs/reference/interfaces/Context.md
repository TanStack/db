---
id: Context
title: Context
---

# Interface: Context

Defined in: packages/db/src/query/builder/types.ts:35

Context - The central state container for query builder operations

This interface tracks all the information needed to build and type-check queries:

**Schema Management**:
- `baseSchema`: The original tables/collections from the `from()` clause
- `schema`: Current available tables (expands with joins, contracts with subqueries)

**Query State**:
- `fromSourceName`: Which table was used in `from()` - needed for optionality logic
- `hasJoins`: Whether any joins have been added (affects result type inference)
- `joinTypes`: Maps table aliases to their join types for optionality calculations

**Result Tracking**:
- `result`: The final shape after `select()` - undefined until select is called

The context evolves through the query builder chain:
1. `from()` sets baseSchema and schema to the same thing
2. `join()` expands schema and sets hasJoins/joinTypes
3. `select()` sets result to the projected shape

## Properties

### baseSchema

```ts
baseSchema: ContextSchema;
```

Defined in: packages/db/src/query/builder/types.ts:37

***

### fromSourceName

```ts
fromSourceName: string;
```

Defined in: packages/db/src/query/builder/types.ts:41

***

### hasJoins?

```ts
optional hasJoins: boolean;
```

Defined in: packages/db/src/query/builder/types.ts:43

***

### joinTypes?

```ts
optional joinTypes: Record<string, "inner" | "left" | "right" | "full" | "outer" | "cross">;
```

Defined in: packages/db/src/query/builder/types.ts:45

***

### result?

```ts
optional result: any;
```

Defined in: packages/db/src/query/builder/types.ts:50

***

### schema

```ts
schema: ContextSchema;
```

Defined in: packages/db/src/query/builder/types.ts:39

***

### singleResult?

```ts
optional singleResult: boolean;
```

Defined in: packages/db/src/query/builder/types.ts:52
