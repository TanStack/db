---
id: Select
title: Select
---

```ts
type Select = object;
```

Defined in: [packages/db/src/query/ir.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L40)

## Index Signature

```ts
[alias: string]: 
  | BasicExpression<any>
  | Aggregate<any>
  | Select
  | IncludesSubquery
  | ConditionalSelect
```
