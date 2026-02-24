---
id: getHavingExpression
title: getHavingExpression
---

# Function: getHavingExpression()

```ts
function getHavingExpression(having): 
  | BasicExpression<any>
| Aggregate<any>;
```

Defined in: [packages/db/src/query/ir.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L165)

Extract the expression from a HAVING clause
HAVING clauses can contain aggregates, unlike regular WHERE clauses

## Parameters

### having

[`Where`](../type-aliases/Where.md)

## Returns

  \| [`BasicExpression`](../type-aliases/BasicExpression.md)\<`any`\>
  \| [`Aggregate`](../classes/Aggregate.md)\<`any`\>
