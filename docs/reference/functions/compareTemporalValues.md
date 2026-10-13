---
id: compareTemporalValues
title: compareTemporalValues
---

```ts
function compareTemporalValues(a, b): number;
```

Defined in: [packages/db/src/utils/comparison.ts:345](https://github.com/TanStack/db/blob/main/packages/db/src/utils/comparison.ts#L345)

Compare two Temporal values of the same type, returning -1, 0, or 1.

The tag checks type agreement. The first value's prototype supplies the static
compare function, so an own `constructor` property cannot change dispatch or
poison later comparisons. Types without a static `.compare` (e.g.
`PlainMonthDay`) throw instead of using text order.

Callers must ensure both arguments are ordinary Temporal objects from one
compatible implementation. Mixed types throw. Replaced prototypes and custom
subclass comparators are outside this contract.

## Parameters

### a

`unknown`

### b

`unknown`

## Returns

`number`
