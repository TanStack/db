---
id: Func
title: Func
---

# Class: Func\<T\>

Defined in: [packages/db/src/query/ir.ts:151](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L151)

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

Defined in: [packages/db/src/query/ir.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L153)

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

Defined in: [packages/db/src/query/ir.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L155)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L154)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:152](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L152)

#### Overrides

```ts
BaseExpression.type
```
