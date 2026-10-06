---
id: or
title: or
---

## Call Signature

```ts
function or(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:231](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L231)

### Parameters

#### left

`ExpressionLike`

#### right

`ExpressionLike`

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function or(
   left, 
   right, ...
rest): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:235](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L235)

### Parameters

#### left

`ExpressionLike`

#### right

`ExpressionLike`

#### rest

...`ExpressionLike`[]

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>
