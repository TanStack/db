---
id: PropRef
title: PropRef
---

# Class: PropRef\<T\>

Defined in: [packages/db/src/query/ir.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L141)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new PropRef<T>(path): PropRef<T>;
```

Defined in: [packages/db/src/query/ir.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L143)

#### Parameters

##### path

`string`[]

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

Defined in: [packages/db/src/query/ir.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L84)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L144)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L142)

#### Overrides

```ts
BaseExpression.type
```
