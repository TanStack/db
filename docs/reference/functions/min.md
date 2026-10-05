---
id: min
title: min
---

## Call Signature

```ts
function min<T>(arg): Aggregate<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:692](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L692)

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

Defined in: [packages/db/src/query/builder/functions.ts:693](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L693)

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

Defined in: [packages/db/src/query/builder/functions.ts:694](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L694)

### Type Parameters

#### T

`T` *extends* `ExpressionLike`

### Parameters

#### arg

`OrderableAggregateArgument`\<`T`\>

### Returns

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`ExtractType`\<`T`\>\>
