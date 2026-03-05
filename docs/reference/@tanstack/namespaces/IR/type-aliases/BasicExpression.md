---
id: BasicExpression
title: BasicExpression
---

# Type Alias: BasicExpression\<T\>

```ts
type BasicExpression<T> = 
  | PropRef<T>
  | Value<T>
| Func<T>;
```

Defined in: packages/db/src/query/ir.ts:123

## Type Parameters

### T

`T` = `any`
