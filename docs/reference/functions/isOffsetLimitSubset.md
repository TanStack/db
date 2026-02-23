---
id: isOffsetLimitSubset
title: isOffsetLimitSubset
---

# Function: isOffsetLimitSubset()

```ts
function isOffsetLimitSubset(subset, superset): boolean;
```

Defined in: packages/db/src/query/predicate-utils.ts:813

Check if one offset+limit range is a subset of another.
Returns true if the subset range is fully contained within the superset range.

A query with `{limit: 10, offset: 0}` loads rows [0, 10).
A query with `{limit: 10, offset: 20}` loads rows [20, 30).

For subset to be satisfied by superset:
- Superset must start at or before subset (superset.offset <= subset.offset)
- Superset must end at or after subset (superset.offset + superset.limit >= subset.offset + subset.limit)

## Parameters

### subset

The offset+limit requirements to check

#### limit?

`number`

#### offset?

`number`

### superset

The offset+limit that might satisfy the requirements

#### limit?

`number`

#### offset?

`number`

## Returns

`boolean`

true if subset range is fully contained within superset range

## Example

```ts
isOffsetLimitSubset({ offset: 0, limit: 5 }, { offset: 0, limit: 10 }) // true
isOffsetLimitSubset({ offset: 5, limit: 5 }, { offset: 0, limit: 10 }) // true (rows 5-9 within 0-9)
isOffsetLimitSubset({ offset: 5, limit: 10 }, { offset: 0, limit: 10 }) // false (rows 5-14 exceed 0-9)
isOffsetLimitSubset({ offset: 20, limit: 10 }, { offset: 0, limit: 10 }) // false (rows 20-29 outside 0-9)
```
