---
id: JoinClause
title: JoinClause
---

Defined in: [packages/db/src/query/ir.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L51)

## Properties

### from

```ts
from: 
  | CollectionRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L52)

***

### left

```ts
left: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L54)

***

### right

```ts
right: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L55)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L53)
