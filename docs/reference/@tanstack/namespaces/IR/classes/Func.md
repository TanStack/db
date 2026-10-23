---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:254](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L254)

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

Defined in: [packages/db/src/query/ir.ts:256](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L256)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:258](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L258)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:257](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L257)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:255](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L255)

#### Overrides

```ts
BaseExpression.type
```
