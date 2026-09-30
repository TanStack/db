---
id: UnionFrom
title: UnionFrom
---

Defined in: [packages/db/src/query/ir.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L115)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionFrom(sources): UnionFrom;
```

Defined in: [packages/db/src/query/ir.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L117)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L117)

***

### type

```ts
type: "unionFrom";
```

Defined in: [packages/db/src/query/ir.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L116)

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

Defined in: [packages/db/src/query/ir.ts:121](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L121)

##### Returns

`string`
