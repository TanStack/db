---
id: or
title: or
---

```ts
function or<T>(...args): WithAggregate<BasicExpression<boolean>, T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:288](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L288)

## Type Parameters

### T

`T` *extends* \[`ExpressionLike`, `ExpressionLike`, `...ExpressionLike[]`\]

## Parameters

### args

...`T`

## Returns

`WithAggregate`\<[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>, `T`\>
