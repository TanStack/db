---
id: CollectionRef
title: CollectionRef
---

Defined in: [packages/db/src/query/ir.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L81)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L85)

#### Parameters

##### collection

[`CollectionImpl`](../../../../classes/CollectionImpl.md)

##### alias

`string`

#### Returns

`CollectionRef`

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

### alias

```ts
alias: string;
```

Defined in: [packages/db/src/query/ir.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L87)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

#### Overrides

```ts
BaseExpression.type
```

## Accessors

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L93)

Opaque runtime identity; aliases are lexical names only.

##### Returns

`string`
