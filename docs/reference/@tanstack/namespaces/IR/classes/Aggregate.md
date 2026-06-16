---
id: Aggregate
title: Aggregate
---

# Class: Aggregate\<T\>

Defined in: [packages/db/src/query/ir.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L129)

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

Defined in: [packages/db/src/query/ir.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L131)

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

Defined in: [packages/db/src/query/ir.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L73)

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

Defined in: [packages/db/src/query/ir.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L133)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L132)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L130)

#### Overrides

```ts
BaseExpression.type
```
