---
id: JoinClause
title: JoinClause
---

Defined in: [packages/db/src/query/ir.ts:48](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L48)

## Properties

### from

```ts
from: 
  | CollectionSourceRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L49)

***

### on

```ts
on: BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/ir.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L51)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:50](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L50)
