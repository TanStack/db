---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:245](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L245)

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

Defined in: [packages/db/src/query/ir.ts:247](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L247)

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

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

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

Defined in: [packages/db/src/query/ir.ts:249](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L249)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:248](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L248)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:246](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L246)

#### Overrides

```ts
BaseExpression.type
```
