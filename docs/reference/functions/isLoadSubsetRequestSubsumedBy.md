---
id: isLoadSubsetRequestSubsumedBy
title: isLoadSubsetRequestSubsumedBy
---

# Function: isLoadSubsetRequestSubsumedBy()

```ts
function isLoadSubsetRequestSubsumedBy(demand, acquisitionRequest): boolean;
```

Defined in: [packages/db/src/query/predicate-utils.ts:953](https://github.com/TanStack/db/blob/main/packages/db/src/query/predicate-utils.ts#L953)

Returns whether one acquisition request subsumes another demand.

This is a directional relationship between request shapes, not proof of
applied or authoritative coverage. It must not be replaced with DemandKey
equality, which answers whether two exact requests are the same.

## Parameters

### demand

[`LoadSubsetOptions`](../type-aliases/LoadSubsetOptions.md)

### acquisitionRequest

[`LoadSubsetOptions`](../type-aliases/LoadSubsetOptions.md)

## Returns

`boolean`
