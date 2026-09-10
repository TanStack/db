---
id: getFromSources
title: getFromSources
---

# Function: getFromSources()

```ts
function getFromSources(from): (
  | CollectionRef
  | QueryRef)[];
```

Defined in: [packages/db/src/query/ir.ts:360](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L360)

Sources declared by a FROM clause. UnionAll branches own their sources.

## Parameters

### from

[`From`](../type-aliases/From.md)

## Returns

(
  \| [`CollectionRef`](../classes/CollectionRef.md)
  \| [`QueryRef`](../classes/QueryRef.md))[]
