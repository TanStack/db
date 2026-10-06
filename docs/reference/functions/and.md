---
id: and
title: and
---

## Call Signature

```ts
function and(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L209)

### Parameters

#### left

`ExpressionLike`

#### right

`ExpressionLike`

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function and(
   left, 
   right, ...
rest): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L213)

### Parameters

#### left

`ExpressionLike`

#### right

`ExpressionLike`

#### rest

...`ExpressionLike`[]

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>
