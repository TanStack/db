---
id: UnionFrom
title: UnionFrom
---

# Class: UnionFrom

Defined in: [packages/db/src/query/ir.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L113)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L115)

#### Parameters

##### sources

([`CollectionRef`](CollectionRef.md) \| [`QueryRef`](QueryRef.md))[]

#### Returns

`UnionFrom`

#### Overrides

```ts
BaseExpression.constructor
```

## Properties

### \_\_returnType

```ts
readonly __returnType: any;
```

Defined in: [packages/db/src/query/ir.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L84)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### sources

```ts
sources: (CollectionRef | QueryRef)[];
```

Defined in: [packages/db/src/query/ir.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L115)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

#### Overrides

```ts
BaseExpression.type
```

## Accessors

### alias

#### Get Signature

```ts
get alias(): string;
```

Defined in: [packages/db/src/query/ir.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L119)

##### Returns

`string`
