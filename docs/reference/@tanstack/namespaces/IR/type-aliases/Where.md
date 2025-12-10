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

Defined in: [packages/db/src/query/ir.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L43)
