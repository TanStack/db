---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L186)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L188)

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L188)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L187)

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

Defined in: [packages/db/src/query/ir.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L192)

##### Returns

`string`
