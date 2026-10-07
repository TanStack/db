---
id: min
title: min
---

## Call Signature

```ts
function min<T>(arg): Aggregate<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:675](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L675)

### Type Parameters

#### T

`T` *extends* `OrderableAggregateValue`

### Parameters

#### arg

`T`

### Returns

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`T`\>

## Call Signature

```ts
function min<T>(arg): Aggregate<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:676](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L676)

### Type Parameters

#### T

`T`

### Parameters

#### arg

`OrderableAggregateWrapperArgument`\<`T`\>

### Returns

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`T`\>

## Call Signature

```ts
function min<T>(arg): Aggregate<ExtractType<T>>;
```

Defined in: [packages/db/src/query/builder/functions.ts:677](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L677)

### Type Parameters

#### T

`T` *extends* `ExpressionLike`

### Parameters

#### arg

`OrderableAggregateArgument`\<`T`\>

### Returns

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`ExtractType`\<`T`\>\>
