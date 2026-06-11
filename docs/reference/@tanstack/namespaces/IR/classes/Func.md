---
id: Func
title: Func
---

# Class: Func\<T\>

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

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

Defined in: [packages/db/src/query/ir.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L116)

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

Defined in: [packages/db/src/query/ir.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L118)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L117)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L115)

#### Overrides

```ts
BaseExpression.type
```
