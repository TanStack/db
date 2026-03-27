---
id: concat
title: concat
---

# Function: concat()

## Call Signature

```ts
function concat<T>(arg): ConcatToArrayWrapper<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L297)

### Type Parameters

#### T

`T` *extends* `StringifiableScalar`

### Parameters

#### arg

`ToArrayWrapper`\<`T`\>

### Returns

`ConcatToArrayWrapper`\<`T`\>

## Call Signature

```ts
function concat(...args): BasicExpression<string>;
```

Defined in: [packages/db/src/query/builder/functions.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L300)

### Parameters

#### args

...`ExpressionLike`[]

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`string`\>
