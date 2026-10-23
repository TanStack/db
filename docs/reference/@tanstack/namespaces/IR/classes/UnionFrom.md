---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L181)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L183)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L183)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L182)

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

Defined in: [packages/db/src/query/ir.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L187)

##### Returns

`string`
