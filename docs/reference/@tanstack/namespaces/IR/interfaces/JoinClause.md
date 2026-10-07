---
id: JoinClause
title: JoinClause
---

Defined in: [packages/db/src/query/ir.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L44)

## Properties

### from

```ts
from: 
  | CollectionRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L45)

***

### on

```ts
on: BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/ir.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L47)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L46)
