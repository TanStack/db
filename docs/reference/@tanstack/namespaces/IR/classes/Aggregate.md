---
id: Aggregate
title: Aggregate
---

# Class: Aggregate\<T\>

Defined in: [packages/db/src/query/ir.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L174)

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

Defined in: [packages/db/src/query/ir.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L176)

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

Defined in: [packages/db/src/query/ir.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L84)

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

Defined in: [packages/db/src/query/ir.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L178)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L177)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L175)

#### Overrides

```ts
BaseExpression.type
```
