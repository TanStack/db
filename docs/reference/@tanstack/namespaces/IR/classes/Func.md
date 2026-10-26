---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:250](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L250)

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

Defined in: [packages/db/src/query/ir.ts:252](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L252)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:254](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L254)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:253](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L253)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:251](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L251)

#### Overrides

```ts
BaseExpression.type
```
