---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L123)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L125)

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

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

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

Defined in: [packages/db/src/query/ir.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L125)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L124)

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

Defined in: [packages/db/src/query/ir.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L129)

##### Returns

`string`
