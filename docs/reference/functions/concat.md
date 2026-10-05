---
id: concat
title: concat
---

## Call Signature

```ts
function concat<T>(arg): ConcatToArrayWrapper<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:324](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L324)

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

Defined in: [packages/db/src/query/builder/functions.ts:327](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L327)

### Parameters

#### args

...`ExpressionLike`[]

### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`string`\>
