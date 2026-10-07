---
id: isBasicOrAggregateExpression
title: isBasicOrAggregateExpression
---

```ts
function isBasicOrAggregateExpression(value): value is BasicExpression<any> | Aggregate<any>;
```

Defined in: [packages/db/src/query/ir.ts:232](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L232)

Distinguish compiler expressions from user objects with IR-like fields.

## Parameters

### value

`unknown`

## Returns

value is BasicExpression\<any\> \| Aggregate\<any\>
