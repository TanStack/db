---
id: toBooleanPredicate
title: toBooleanPredicate
---

# Function: toBooleanPredicate()

```ts
function toBooleanPredicate(result): boolean;
```

Defined in: [packages/db/src/query/compiler/evaluators.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/compiler/evaluators.ts#L54)

Converts a 3-valued logic result to a boolean for use in WHERE/HAVING filters.
In SQL, UNKNOWN (null) values in WHERE clauses exclude rows, matching false behavior.

## Parameters

### result

The 3-valued logic result: true, false, or null (UNKNOWN)

`boolean` | `null`

## Returns

`boolean`

true only if result is explicitly true, false otherwise

Truth table:
- true → true (include row)
- false → false (exclude row)
- null (UNKNOWN) → false (exclude row, matching SQL behavior)
