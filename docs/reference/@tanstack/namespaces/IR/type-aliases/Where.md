---
id: Where
title: Where
---

# Type Alias: Where

```ts
type Where = 
  | BasicExpression<boolean>
  | {
  expression: BasicExpression<boolean>;
  residual?: boolean;
};
```

Defined in: packages/db/src/query/ir.ts:43
