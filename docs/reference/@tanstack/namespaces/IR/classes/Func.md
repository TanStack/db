---
id: Func
title: Func
---

# Class: Func\<T\>

Defined in: [packages/db/src/query/ir.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L110)

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

Defined in: [packages/db/src/query/ir.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L112)

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

Defined in: [packages/db/src/query/ir.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L69)

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

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L113)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L111)

#### Overrides

```ts
BaseExpression.type
```
