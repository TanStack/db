---
id: gte
title: gte
---

## Call Signature

```ts
function gte<L, R>(left, right): WithAggregate<BasicExpression<boolean>, [L, R]>;
```

Defined in: [packages/db/src/query/builder/functions.ts:220](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L220)

### Type Parameters

#### L

`L` *extends* `ExpressionLike`

#### R

`R` *extends* `ExpressionLike`

### Parameters

#### left

`L` & `true` *extends* `ContainsAggregate`\<`L` \| `R`, \[\[`L`, `R`\]\]\> ? `unknown` : `never`

#### right

`R`

### Returns

`WithAggregate`\<[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>, \[`L`, `R`\]\>

## Call Signature

```ts
function gte<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:224](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L224)

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

Defined in: [packages/db/src/query/builder/functions.ts:228](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L228)

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

Defined in: [packages/db/src/query/builder/functions.ts:232](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L232)

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
