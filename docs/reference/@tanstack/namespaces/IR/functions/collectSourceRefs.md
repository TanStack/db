---
id: collectSourceRefs
title: collectSourceRefs
---

```ts
function collectSourceRefs(query): CollectionSourceRef[];
```

Defined in: [packages/db/src/query/ir.ts:348](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L348)

Returns each lexical Collection or descriptor source in a query tree once.

## Parameters

### query

[`QueryIR`](../interfaces/QueryIR.md)

## Returns

[`CollectionSourceRef`](../type-aliases/CollectionSourceRef.md)[]
