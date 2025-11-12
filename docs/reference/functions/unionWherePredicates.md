---
id: unionWherePredicates
title: unionWherePredicates
---

# Function: unionWherePredicates()

```ts
function unionWherePredicates(predicates): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/predicate-utils.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/query/predicate-utils.ts#L295)

Combine multiple where predicates with OR logic (union).
Returns a predicate that is satisfied when any input predicate is satisfied.
Simplifies when possible (e.g., age > 10 OR age > 20 → age > 10).

## Parameters

### predicates

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>[]

Array of where predicates to union

## Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

Combined predicate representing the union

## Examples

```ts
// Take least restrictive
unionWherePredicates([gt(ref('age'), val(10)), gt(ref('age'), val(20))]) // age > 10
```

```ts
// Combine equals into IN
unionWherePredicates([eq(ref('age'), val(5)), eq(ref('age'), val(10))]) // age IN [5, 10]
```
