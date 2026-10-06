---
id: Context
title: Context
---

Defined in: [packages/db/src/query/builder/types.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L47)

Context - The central state container for query builder operations

This interface tracks all the information needed to build and type-check queries:

**Schema Management**:
- `baseSchema`: The original tables/collections from the `from()` clause
- `schema`: Current available tables (expands with joins, contracts with subqueries)

**Query State**:
- `fromSourceName`: Which table was used in `from()` or the first
  `unionAll()` source - needed for optionality logic
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

Defined in: [packages/db/src/query/builder/types.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L49)

***

### fromSourceName

```ts
fromSourceName: string;
```

Defined in: [packages/db/src/query/builder/types.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L55)

***

### fromSourceNames?

```ts
optional fromSourceNames: readonly string[];
```

Defined in: [packages/db/src/query/builder/types.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L57)

***

### hasJoins?

```ts
optional hasJoins: boolean;
```

Defined in: [packages/db/src/query/builder/types.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L61)

***

### hasResult?

```ts
optional hasResult: true;
```

Defined in: [packages/db/src/query/builder/types.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L70)

***

### hasUnionFrom?

```ts
optional hasUnionFrom: true;
```

Defined in: [packages/db/src/query/builder/types.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L59)

***

### joinTypes?

```ts
optional joinTypes: Record<string, "inner" | "left" | "right" | "full" | "outer" | "cross">;
```

Defined in: [packages/db/src/query/builder/types.ts:63](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L63)

***

### refsSchema?

```ts
optional refsSchema: ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L53)

***

### result?

```ts
optional result: any;
```

Defined in: [packages/db/src/query/builder/types.ts:68](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L68)

***

### schema

```ts
schema: ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L51)

***

### singleResult?

```ts
optional singleResult: boolean;
```

Defined in: [packages/db/src/query/builder/types.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L72)
