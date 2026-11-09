---
id: and
title: and
---

```ts
function and<T>(...args): WithAggregate<BasicExpression<boolean>, T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:272](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L272)

## Type Parameters

### T

`T` *extends* \[`ExpressionLike`, `ExpressionLike`, `...ExpressionLike[]`\]

## Parameters

### args

...`T`

## Returns

`WithAggregate`\<[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>, `T`\>
