---
id: UnionFrom
title: UnionFrom
---

# Class: UnionFrom

Defined in: [packages/db/src/query/ir.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L105)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L107)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L107)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L106)

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

Defined in: [packages/db/src/query/ir.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L111)

##### Returns

`string`
