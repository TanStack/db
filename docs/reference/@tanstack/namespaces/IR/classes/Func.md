---
id: Func
title: Func
---

Defined in: [packages/db/src/query/ir.ts:259](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L259)

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

Defined in: [packages/db/src/query/ir.ts:261](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L261)

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L263)

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:262](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L262)

***

### type

```ts
type: "func";
```

Defined in: [packages/db/src/query/ir.ts:260](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L260)

#### Overrides

```ts
BaseExpression.type
```
