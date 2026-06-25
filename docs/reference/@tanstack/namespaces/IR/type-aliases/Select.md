---
id: Select
title: Select
---

# Type Alias: Select

```ts
type Select = object;
```

Defined in: [packages/db/src/query/ir.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L38)

## Index Signature

```ts
[alias: string]: 
  | BasicExpression<any>
  | Select
  | Aggregate<any>
  | IncludesSubquery
  | ConditionalSelect
```
