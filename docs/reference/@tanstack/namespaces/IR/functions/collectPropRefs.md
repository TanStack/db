---
id: collectPropRefs
title: collectPropRefs
---

```ts
function collectPropRefs(expression): PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:278](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L278)

Collect refs from an IR expression, including aggregate arguments.

## Parameters

### expression

[`BasicExpression`](../type-aliases/BasicExpression.md)\<`any`\> | [`Aggregate`](../classes/Aggregate.md)\<`any`\>

## Returns

[`PropRef`](../classes/PropRef.md)\<`any`\>[]
