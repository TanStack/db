---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L181)

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

Defined in: [packages/db/src/query/ir.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L183)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L185)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L184)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L182)

#### Overrides

```ts
BaseExpression.type
```
