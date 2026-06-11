---
id: JoinClause
title: JoinClause
---

# Interface: JoinClause

Defined in: [packages/db/src/query/ir.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L40)

## Properties

### from

```ts
from: 
  | CollectionRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L41)

***

### left

```ts
left: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L43)

***

### right

```ts
right: BasicExpression;
```

Defined in: [packages/db/src/query/ir.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L44)

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:42](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L42)
