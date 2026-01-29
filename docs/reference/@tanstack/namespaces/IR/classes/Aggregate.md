---
id: Aggregate
title: Aggregate
---

# Class: Aggregate\<T\>

Defined in: [packages/db/src/query/ir.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L125)

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

Defined in: [packages/db/src/query/ir.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L127)

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

Defined in: [packages/db/src/query/ir.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L129)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L128)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L126)

#### Overrides

```ts
BaseExpression.type
```
