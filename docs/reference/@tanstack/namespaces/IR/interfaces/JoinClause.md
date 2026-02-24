---
id: JoinClause
title: JoinClause
---

# Interface: JoinClause

Defined in: [packages/db/src/query/ir.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L36)

## Properties

### from

```ts
from: 
  | CollectionRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L37)

***

### left

```ts
left: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L39)

***

### right

```ts
right: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L40)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L38)
