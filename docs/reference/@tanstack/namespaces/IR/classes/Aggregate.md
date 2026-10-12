---
id: Aggregate
title: Aggregate
---

Defined in: [packages/db/src/query/ir.ts:211](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L211)

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

Defined in: [packages/db/src/query/ir.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L213)

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

Defined in: [packages/db/src/query/ir.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L215)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L214)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L212)

#### Overrides

```ts
BaseExpression.type
```
