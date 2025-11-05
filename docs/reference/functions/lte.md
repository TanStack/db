---
id: lte
title: lte
---

# Function: lte()

## Call Signature

```ts
function lte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L167)

### Type Parameters

#### T

`T`

### Parameters

#### left

`ComparisonOperand`\<`T`\>

#### right

`ComparisonOperand`\<`T`\>

### Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function lte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:171](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L171)

### Type Parameters

#### T

`T` *extends* `string` \| `number`

### Parameters

#### left

`ComparisonOperandPrimitive`\<`T`\>

#### right

`ComparisonOperandPrimitive`\<`T`\>

### Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function lte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L175)

### Type Parameters

#### T

`T`

### Parameters

#### left

[`Aggregate`](../../@tanstack/namespaces/IR/classes/Aggregate.md)\<`T`\>

#### right

`any`

### Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>
