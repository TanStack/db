---
id: add
title: add
---

```ts
function add<T1, T2>(left, right): WithAggregate<BinaryNumericReturnType, [T1, T2]>;
```

Defined in: [packages/db/src/query/builder/functions.ts:528](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L528)

## Type Parameters

### T1

`T1` *extends* `ExpressionLike`

### T2

`T2` *extends* `ExpressionLike`

## Parameters

### left

`T1`

### right

`T2`

## Returns

`WithAggregate`\<`BinaryNumericReturnType`, \[`T1`, `T2`\]\>
