---
id: isOrderBySubset
title: isOrderBySubset
---

# Function: isOrderBySubset()

```ts
function isOrderBySubset(subset, superset): boolean;
```

Defined in: packages/db/src/query/predicate-utils.ts:715

Check if one orderBy clause is a subset of another.
Returns true if the subset ordering requirements are satisfied by the superset ordering.

## Parameters

### subset

The ordering requirements to check

[`OrderBy`](../@tanstack/namespaces/IR/type-aliases/OrderBy.md) | `undefined`

### superset

The ordering that might satisfy the requirements

[`OrderBy`](../@tanstack/namespaces/IR/type-aliases/OrderBy.md) | `undefined`

## Returns

`boolean`

true if subset is satisfied by superset

## Example

```ts
// Subset is prefix of superset
isOrderBySubset([{expr: age, asc}], [{expr: age, asc}, {expr: name, desc}]) // true
```
