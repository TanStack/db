---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L209)

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

Defined in: [packages/db/src/query/ir.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L213)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L212)

***

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L214)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:211](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L211)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L210)

#### Overrides

```ts
BaseExpression.type
```
