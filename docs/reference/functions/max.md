---
id: max
title: max
---

## Call Signature

```ts
function max<T>(arg): Aggregate<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:605](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L605)

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
function max<T>(arg): Aggregate<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:606](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L606)

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
function max<T>(arg): Aggregate<ExtractType<T>>;
```

Defined in: [packages/db/src/query/builder/functions.ts:607](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L607)

### Type Parameters

#### T

`T` *extends* `ExpressionLike`

### Parameters

#### arg

`OrderableAggregateArgument`\<`T`\>

### Returns

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`ExtractType`\<`T`\>\>
