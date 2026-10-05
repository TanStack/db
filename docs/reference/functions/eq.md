---
id: eq
title: eq
---

## Call Signature

```ts
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L160)

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
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L164)

### Type Parameters

#### T

`T` *extends* `string` \| `number` \| `boolean`

### Parameters

#### left

`ComparisonOperandPrimitive`\<`T`\>

#### right

`ComparisonOperandPrimitive`\<`T`\>

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>

## Call Signature

```ts
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L168)

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
