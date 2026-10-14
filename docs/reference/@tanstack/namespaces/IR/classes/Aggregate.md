---
id: Aggregate
title: Aggregate
---

Defined in: [packages/db/src/query/ir.ts:260](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L260)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new Aggregate<T>(name, args): Aggregate<T>;
```

Defined in: [packages/db/src/query/ir.ts:262](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L262)

#### Parameters

##### name

`string`

##### args

[`BasicExpression`](../type-aliases/BasicExpression.md)\<`any`\>[]

#### Returns

`Aggregate`\<`T`\>

#### Overrides

```ts
BaseExpression<T>.constructor
```

## Properties

### \_\_returnType

```ts
readonly __returnType: T;
```

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### args

```ts
args: BasicExpression<any>[];
```

Defined in: [packages/db/src/query/ir.ts:264](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L264)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L263)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:261](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L261)

#### Overrides

```ts
BaseExpression.type
```
