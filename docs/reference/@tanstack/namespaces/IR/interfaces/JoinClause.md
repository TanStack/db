---
id: JoinClause
title: JoinClause
---

# Interface: JoinClause

Defined in: [packages/db/src/query/ir.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L49)

## Properties

### from

```ts
from: 
  | CollectionRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:50](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L50)

***

### left

```ts
left: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L52)

***

### right

```ts
right: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L53)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L51)
