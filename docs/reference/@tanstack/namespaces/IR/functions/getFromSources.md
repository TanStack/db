---
id: getFromSources
title: getFromSources
---

```ts
function getFromSources(from): (
  | CollectionSourceRef
  | QueryRef)[];
```

Defined in: [packages/db/src/query/ir.ts:445](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L445)

Sources declared by a FROM clause. UnionAll branches own their sources.

## Parameters

### from

[`From`](../type-aliases/From.md)

## Returns

(
  \| [`CollectionSourceRef`](../type-aliases/CollectionSourceRef.md)
  \| [`QueryRef`](../classes/QueryRef.md))[]
