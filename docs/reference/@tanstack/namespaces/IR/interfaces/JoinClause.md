---
id: JoinClause
title: JoinClause
---

Defined in: [packages/db/src/query/ir.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L53)

## Properties

### from

```ts
from: 
  | CollectionSourceRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L54)

***

### on

```ts
on: BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/ir.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L56)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L55)
