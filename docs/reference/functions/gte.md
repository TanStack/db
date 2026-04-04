---
id: gte
title: gte
---

# Function: gte()

## Call Signature

```ts
function gte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L159)

### Type Parameters

#### T

`T`

### Parameters

#### left

`ComparisonOperand`\<`T`\>

#### right

`ComparisonOperand`\<`T`\>

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function gte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L163)

### Type Parameters

#### T

`T` *extends* `string` \| `number`

### Parameters

#### left

`ComparisonOperandPrimitive`\<`T`\>

#### right

`ComparisonOperandPrimitive`\<`T`\>

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function gte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L167)

### Type Parameters

#### T

`T`

### Parameters

#### left

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`T`\>

#### right

`any`

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>
