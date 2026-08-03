---
id: PropRef
title: PropRef
---

# Class: PropRef\<T\>

Defined in: [packages/db/src/query/ir.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L133)

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

Defined in: [packages/db/src/query/ir.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L135)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L136)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:134](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L134)

#### Overrides

```ts
BaseExpression.type
```
