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

Defined in: [packages/db/src/query/ir.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L263)

## Type Parameters

### T

`T` = `any`
