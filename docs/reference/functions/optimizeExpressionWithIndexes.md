---
id: optimizeExpressionWithIndexes
title: optimizeExpressionWithIndexes
---

# Function: optimizeExpressionWithIndexes()

```ts
function optimizeExpressionWithIndexes<T, TKey>(expression, collection): OptimizationResult<TKey>;
```

Defined in: [packages/db/src/utils/index-optimization.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/utils/index-optimization.ts#L100)

Optimizes a query expression using available indexes to find matching keys

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Parameters

### expression

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

### collection

[`CollectionLike`](../interfaces/CollectionLike.md)\<`T`, `TKey`\>

## Returns

`OptimizationResult`\<`TKey`\>
