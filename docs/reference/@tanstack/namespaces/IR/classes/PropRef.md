---
id: PropRef
title: PropRef
---

# Class: PropRef\<T\>

Defined in: packages/db/src/query/ir.ts:92

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

Defined in: packages/db/src/query/ir.ts:94

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

Defined in: packages/db/src/query/ir.ts:69

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

Defined in: packages/db/src/query/ir.ts:95

***

### type

```ts
type: "ref";
```

Defined in: packages/db/src/query/ir.ts:93

#### Overrides

```ts
BaseExpression.type
```
