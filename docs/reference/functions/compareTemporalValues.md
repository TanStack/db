---
id: compareTemporalValues
title: compareTemporalValues
---

```ts
function compareTemporalValues(a, b): number;
```

Defined in: [packages/db/src/utils/comparison.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/utils/comparison.ts#L300)

Compare two Temporal values of the same type, returning -1, 0, or 1.

The tags check type agreement. Types without a static `.compare` (e.g.
`PlainMonthDay`) throw instead of using text order.

Callers must ensure both arguments are Temporal objects; mixed types throw.

## Parameters

### a

`unknown`

### b

`unknown`

## Returns

`number`
