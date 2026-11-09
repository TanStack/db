---
id: eq
title: eq
---

## Call Signature

```ts
function eq<L, R>(left, right): WithAggregate<BasicExpression<boolean>, [L, R]>;
```

Defined in: [packages/db/src/query/builder/functions.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L186)

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
function eq<T>(left, right): BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/builder/functions.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L190)

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

Defined in: [packages/db/src/query/builder/functions.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L194)

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

Defined in: [packages/db/src/query/builder/functions.ts:198](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L198)

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
