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

Defined in: [packages/db/src/query/ir.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L127)

## Type Parameters

### T

`T` = `any`
