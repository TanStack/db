---
id: eq
title: eq
---

# Function: eq()

## Call Signature

```ts
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: packages/db/src/query/builder/functions.ts:115

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
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: packages/db/src/query/builder/functions.ts:119

### Type Parameters

#### T

`T` *extends* `string` \| `number` \| `boolean`

### Parameters

#### left

`ComparisonOperandPrimitive`\<`T`\>

#### right

`ComparisonOperandPrimitive`\<`T`\>

### Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: packages/db/src/query/builder/functions.ts:123

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
