---
id: Where
title: Where
---

```ts
type Where = 
  | BasicExpression<boolean>
  | {
  expression: BasicExpression<boolean>;
  residual?: boolean;
};
```

Defined in: [packages/db/src/query/ir.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L59)
