---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:200](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L200)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new PropRef<T>(
   path, 
   sourceAlias?, 
bindingId?): PropRef<T>;
```

Defined in: [packages/db/src/query/ir.ts:204](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L204)

#### Parameters

##### path

`string`[]

##### sourceAlias?

`string`

##### bindingId?

`string`

#### Returns

`PropRef`\<`T`\>

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

### bindingId?

```ts
readonly optional bindingId: string;
```

Defined in: [packages/db/src/query/ir.ts:203](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L203)

***

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L205)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:202](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L202)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:201](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L201)

#### Overrides

```ts
BaseExpression.type
```
