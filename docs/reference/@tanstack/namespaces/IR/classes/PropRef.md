---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L214)

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

Defined in: [packages/db/src/query/ir.ts:218](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L218)

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:217](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L217)

***

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:219](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L219)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:216](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L216)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L215)

#### Overrides

```ts
BaseExpression.type
```
