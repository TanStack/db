---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L108)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L110)

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

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

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

Defined in: [packages/db/src/query/ir.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L110)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L109)

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

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

##### Returns

`string`
