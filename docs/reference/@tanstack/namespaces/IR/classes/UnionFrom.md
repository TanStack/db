---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L172)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L174)

#### Parameters

##### sources

(
  \| [`CollectionSourceRef`](../type-aliases/CollectionSourceRef.md)
  \| [`QueryRef`](QueryRef.md))[]

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

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### sources

```ts
sources: (
  | CollectionSourceRef
  | QueryRef)[];
```

Defined in: [packages/db/src/query/ir.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L174)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L173)

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

Defined in: [packages/db/src/query/ir.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L178)

##### Returns

`string`
