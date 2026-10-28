---
id: Context
title: Context
---

Defined in: [packages/db/src/query/builder/types.ts:48](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L48)

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

Defined in: [packages/db/src/query/builder/types.ts:50](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L50)

***

### fromSourceName

```ts
fromSourceName: string;
```

Defined in: [packages/db/src/query/builder/types.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L56)

***

### fromSourceNames?

```ts
optional fromSourceNames: readonly string[];
```

Defined in: [packages/db/src/query/builder/types.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L58)

***

### hasJoins?

```ts
optional hasJoins: boolean;
```

Defined in: [packages/db/src/query/builder/types.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L62)

***

### hasResult?

```ts
optional hasResult: true;
```

Defined in: [packages/db/src/query/builder/types.ts:71](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L71)

***

### hasUnionFrom?

```ts
optional hasUnionFrom: true;
```

Defined in: [packages/db/src/query/builder/types.ts:60](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L60)

***

### joinTypes?

```ts
optional joinTypes: Record<string, "inner" | "left" | "right" | "full" | "outer" | "cross">;
```

Defined in: [packages/db/src/query/builder/types.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L64)

***

### refsSchema?

```ts
optional refsSchema: ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L54)

***

### result?

```ts
optional result: any;
```

Defined in: [packages/db/src/query/builder/types.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L69)

***

### schema

```ts
schema: ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L52)

***

### singleResult?

```ts
optional singleResult: boolean;
```

Defined in: [packages/db/src/query/builder/types.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L73)
