---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L196)

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

Defined in: [packages/db/src/query/ir.ts:198](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L198)

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

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

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

Defined in: [packages/db/src/query/ir.ts:200](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L200)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:199](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L199)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:197](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L197)

#### Overrides

```ts
BaseExpression.type
```
