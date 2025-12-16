---
id: isPredicateSubset
title: isPredicateSubset
---

# Function: isPredicateSubset()

```ts
function isPredicateSubset(subset, superset): boolean;
```

Defined in: [packages/db/src/query/predicate-utils.ts:801](https://github.com/TanStack/db/blob/main/packages/db/src/query/predicate-utils.ts#L801)

Check if one predicate (where + orderBy + limit) is a subset of another.
Returns true if all aspects of the subset predicate are satisfied by the superset.

## Parameters

### subset

[`LoadSubsetOptions`](../type-aliases/LoadSubsetOptions.md)

The predicate requirements to check

### superset

[`LoadSubsetOptions`](../type-aliases/LoadSubsetOptions.md)

The predicate that might satisfy the requirements

## Returns

`boolean`

true if subset is satisfied by superset

## Example

```ts
isPredicateSubset(
  { where: gt(ref('age'), val(20)), limit: 10 },
  { where: gt(ref('age'), val(10)), limit: 20 }
) // true
```
