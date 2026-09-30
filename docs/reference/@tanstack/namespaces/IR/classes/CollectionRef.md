---
id: CollectionRef
title: CollectionRef
---

Defined in: [packages/db/src/query/ir.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L89)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L93)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L95)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L94)

***

### sourceId

```ts
readonly sourceId: string;
```

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

Opaque runtime identity; aliases are lexical names only.

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L90)

#### Overrides

```ts
BaseExpression.type
```
