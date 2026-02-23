---
id: Func
title: Func
---

# Class: Func\<T\>

Defined in: packages/db/src/query/ir.ts:110

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

Defined in: packages/db/src/query/ir.ts:112

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

Defined in: packages/db/src/query/ir.ts:69

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

Defined in: packages/db/src/query/ir.ts:114

***

### name

```ts
name: string;
```

Defined in: packages/db/src/query/ir.ts:113

***

### type

```ts
type: "func";
```

Defined in: packages/db/src/query/ir.ts:111

#### Overrides

```ts
BaseExpression.type
```
