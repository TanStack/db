---
id: concat
title: concat
---

## Call Signature

```ts
function concat<T>(arg): ConcatToArrayWrapper<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:388](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L388)

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
function concat<T>(...args): WithAggregate<BasicExpression<string>, T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:391](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L391)

### Type Parameters

#### T

`T` *extends* `ExpressionLike`[]

### Parameters

#### args

...`T`

### Returns

`WithAggregate`\<[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`string`\>, `T`\>
