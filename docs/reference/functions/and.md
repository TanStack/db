---
id: and
title: and
---

# Function: and()

## Call Signature

```ts
function and(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:199](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L199)

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

Defined in: [packages/db/src/query/builder/functions.ts:203](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L203)

### Parameters

#### left

`ExpressionLike`

#### right

`ExpressionLike`

#### rest

...`ExpressionLike`[]

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>
