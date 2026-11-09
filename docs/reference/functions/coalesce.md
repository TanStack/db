---
id: coalesce
title: coalesce
---

```ts
function coalesce<T>(...args): WithAggregate<HasGuaranteedNonNull<T> extends true ? BasicExpression<CoalesceArgTypes<T>> : BasicExpression<CoalesceArgTypes<T> | null>>;
```

Defined in: [packages/db/src/query/builder/functions.ts:442](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L442)

## Type Parameters

### T

`T` *extends* \[`ExpressionLike`, `...ExpressionLike[]`\]

## Parameters

### args

...`T`

## Returns

`WithAggregate`\<`HasGuaranteedNonNull`\<`T`\> *extends* `true` ? [`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`CoalesceArgTypes`\<`T`\>\> : [`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`CoalesceArgTypes`\<`T`\> \| `null`\>\>
