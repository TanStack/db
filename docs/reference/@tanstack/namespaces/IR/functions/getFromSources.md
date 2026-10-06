---
id: getFromSources
title: getFromSources
---

```ts
function getFromSources(from): (
  | CollectionRef
  | QueryRef)[];
```

Defined in: [packages/db/src/query/ir.ts:346](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L346)

Sources declared by a FROM clause. UnionAll branches own their sources.

## Parameters

### from

[`From`](../type-aliases/From.md)

## Returns

(
  \| [`CollectionRef`](../classes/CollectionRef.md)
  \| [`QueryRef`](../classes/QueryRef.md))[]
