---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L205)

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

Defined in: [packages/db/src/query/ir.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L209)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:208](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L208)

***

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L210)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:207](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L207)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L206)

#### Overrides

```ts
BaseExpression.type
```
