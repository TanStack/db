---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L172)

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

Defined in: [packages/db/src/query/ir.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L174)

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

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

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

Defined in: [packages/db/src/query/ir.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L176)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L175)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L173)

#### Overrides

```ts
BaseExpression.type
```
