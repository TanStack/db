---
id: getFromSources
title: getFromSources
---

```ts
function getFromSources(from): (
  | CollectionSourceRef
  | QueryRef)[];
```

Defined in: [packages/db/src/query/ir.ts:444](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L444)

Sources declared by a FROM clause. UnionAll branches own their sources.

## Parameters

### from

[`From`](../type-aliases/From.md)

## Returns

(
  \| [`CollectionSourceRef`](../type-aliases/CollectionSourceRef.md)
  \| [`QueryRef`](../classes/QueryRef.md))[]
