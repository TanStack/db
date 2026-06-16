---
id: Select
title: Select
---

# Type Alias: Select

```ts
type Select = object;
```

Defined in: [packages/db/src/query/ir.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L34)

## Index Signature

```ts
[alias: string]: 
  | BasicExpression<any>
  | Select
  | Aggregate<any>
  | IncludesSubquery
```
