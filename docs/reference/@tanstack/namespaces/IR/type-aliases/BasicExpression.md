---
id: BasicExpression
title: BasicExpression
---

```ts
type BasicExpression<T> = 
  | PropRef<T>
  | Value<T>
| Func<T>;
```

Defined in: [packages/db/src/query/ir.ts:267](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L267)

## Type Parameters

### T

`T` = `any`
