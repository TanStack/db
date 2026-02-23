---
id: isWhereSubset
title: isWhereSubset
---

# Function: isWhereSubset()

```ts
function isWhereSubset(subset, superset): boolean;
```

Defined in: packages/db/src/query/predicate-utils.ts:21

Check if one where clause is a logical subset of another.
Returns true if the subset predicate is more restrictive than (or equal to) the superset predicate.

## Parameters

### subset

The potentially more restrictive predicate

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\> | `undefined`

### superset

The potentially less restrictive predicate

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\> | `undefined`

## Returns

`boolean`

true if subset logically implies superset

## Examples

```ts
// age > 20 is subset of age > 10 (more restrictive)
isWhereSubset(gt(ref('age'), val(20)), gt(ref('age'), val(10))) // true
```

```ts
// age > 10 AND name = 'X' is subset of age > 10 (more conditions)
isWhereSubset(and(gt(ref('age'), val(10)), eq(ref('name'), val('X'))), gt(ref('age'), val(10))) // true
```
