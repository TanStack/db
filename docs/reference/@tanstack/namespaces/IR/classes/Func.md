---
id: Func
title: Func
---

# Class: Func\<T\>

Defined in: [packages/db/src/query/ir.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L159)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new Func<T>(name, args): Func<T>;
```

Defined in: [packages/db/src/query/ir.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L161)

#### Parameters

##### name

`string`

##### args

[`BasicExpression`](../type-aliases/BasicExpression.md)\<`any`\>[]

#### Returns

`Func`\<`T`\>

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

Defined in: [packages/db/src/query/ir.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L163)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:162](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L162)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L160)

#### Overrides

```ts
BaseExpression.type
```
