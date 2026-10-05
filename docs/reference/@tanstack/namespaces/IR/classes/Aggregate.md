---
id: Aggregate
title: Aggregate
---

Defined in: [packages/db/src/query/ir.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L195)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new Aggregate<T>(name, args): Aggregate<T>;
```

Defined in: [packages/db/src/query/ir.ts:197](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L197)

#### Parameters

##### name

`string`

##### args

[`BasicExpression`](../type-aliases/BasicExpression.md)\<`any`\>[]

#### Returns

`Aggregate`\<`T`\>

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

Defined in: [packages/db/src/query/ir.ts:199](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L199)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:198](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L198)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L196)

#### Overrides

```ts
BaseExpression.type
```
