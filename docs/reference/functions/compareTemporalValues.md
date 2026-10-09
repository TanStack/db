---
id: compareTemporalValues
title: compareTemporalValues
---

```ts
function compareTemporalValues(a, b): number;
```

Defined in: [packages/db/src/utils/comparison.ts:310](https://github.com/TanStack/db/blob/main/packages/db/src/utils/comparison.ts#L310)

Compare two Temporal values of the same type, returning -1, 0, or 1.

Dispatch is keyed on `Symbol.toStringTag` (the brand already checked by
`isTemporal`) rather than `a.constructor`, making it robust across realms
and resistant to a shadowed `constructor` property. Types without a static
`.compare` (e.g. `PlainMonthDay`) throw rather than fall back to string
comparison, matching Temporal's design intent.

Callers must ensure both arguments are Temporal objects; mixed types throw.

## Parameters

### a

`unknown`

### b

`unknown`

## Returns

`number`
