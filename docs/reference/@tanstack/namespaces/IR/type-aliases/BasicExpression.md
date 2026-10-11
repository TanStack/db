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

Defined in: [packages/db/src/query/ir.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L209)

## Type Parameters

### T

`T` = `any`
