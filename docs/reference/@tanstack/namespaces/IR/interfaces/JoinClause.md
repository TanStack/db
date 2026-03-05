---
id: JoinClause
title: JoinClause
---

# Interface: JoinClause

Defined in: packages/db/src/query/ir.ts:36

## Properties

### from

```ts
from: 
  | CollectionRef
  | QueryRef;
```

Defined in: packages/db/src/query/ir.ts:37

***

### left

```ts
left: BasicExpression;
```

Defined in: packages/db/src/query/ir.ts:39

***

### right

```ts
right: BasicExpression;
```

Defined in: packages/db/src/query/ir.ts:40

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: packages/db/src/query/ir.ts:38
