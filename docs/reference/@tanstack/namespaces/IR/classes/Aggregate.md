---
id: Aggregate
title: Aggregate
---

Defined in: [packages/db/src/query/ir.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L187)

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

Defined in: [packages/db/src/query/ir.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L189)

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

Defined in: [packages/db/src/query/ir.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L191)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L190)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L188)

#### Overrides

```ts
BaseExpression.type
```
