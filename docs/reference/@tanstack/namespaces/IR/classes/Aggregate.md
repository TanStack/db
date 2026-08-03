---
id: Aggregate
title: Aggregate
---

# Class: Aggregate\<T\>

Defined in: [packages/db/src/query/ir.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L166)

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

Defined in: [packages/db/src/query/ir.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L168)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:170](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L170)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L169)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L167)

#### Overrides

```ts
BaseExpression.type
```
