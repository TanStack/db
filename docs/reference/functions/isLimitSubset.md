---
id: isLimitSubset
title: isLimitSubset
---

# Function: isLimitSubset()

```ts
function isLimitSubset(subset, superset): boolean;
```

Defined in: packages/db/src/query/predicate-utils.ts:773

Check if one limit is a subset of another.
Returns true if the subset limit requirements are satisfied by the superset limit.

Note: This function does NOT consider offset. For offset-aware subset checking,
use `isOffsetLimitSubset` instead.

## Parameters

### subset

The limit requirement to check

`number` | `undefined`

### superset

The limit that might satisfy the requirement

`number` | `undefined`

## Returns

`boolean`

true if subset is satisfied by superset

## Example

```ts
isLimitSubset(10, 20) // true (requesting 10 items when 20 are available)
isLimitSubset(20, 10) // false (requesting 20 items when only 10 are available)
isLimitSubset(10, undefined) // true (requesting 10 items when unlimited are available)
```
