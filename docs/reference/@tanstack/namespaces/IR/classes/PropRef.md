---
id: PropRef
title: PropRef
---

# Class: PropRef\<T\>

Defined in: [packages/db/src/query/ir.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L96)

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

Defined in: [packages/db/src/query/ir.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L98)

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

Defined in: [packages/db/src/query/ir.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L73)

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

Defined in: [packages/db/src/query/ir.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L99)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

#### Overrides

```ts
BaseExpression.type
```
