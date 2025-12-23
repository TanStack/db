---
id: deepEquals
title: deepEquals
---

# Function: deepEquals()

```ts
function deepEquals(a, b): boolean;
```

Defined in: [packages/db/src/utils.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/utils.ts#L29)

Deep equality function that compares two values recursively
Handles primitives, objects, arrays, Date, RegExp, Map, Set, TypedArrays, and Temporal objects

## Parameters

### a

`any`

First value to compare

### b

`any`

Second value to compare

## Returns

`boolean`

True if the values are deeply equal, false otherwise

## Example

```typescript
deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 }) // true (property order doesn't matter)
deepEquals([1, { x: 2 }], [1, { x: 2 }]) // true
deepEquals({ a: 1 }, { a: 2 }) // false
deepEquals(new Date('2023-01-01'), new Date('2023-01-01')) // true
deepEquals(new Map([['a', 1]]), new Map([['a', 1]])) // true
```
