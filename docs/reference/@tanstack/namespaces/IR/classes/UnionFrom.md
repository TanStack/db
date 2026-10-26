---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L177)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L179)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L179)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L178)

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

Defined in: [packages/db/src/query/ir.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L183)

##### Returns

`string`
