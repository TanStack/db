---
id: CollectionRef
title: CollectionRef
---

# Class: CollectionRef

Defined in: [packages/db/src/query/ir.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L87)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L91)

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

Defined in: [packages/db/src/query/ir.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L84)

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

Defined in: [packages/db/src/query/ir.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L93)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

***

### sourceId

```ts
readonly sourceId: string;
```

Defined in: [packages/db/src/query/ir.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L90)

Opaque runtime identity; aliases are lexical names only.

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

#### Overrides

```ts
BaseExpression.type
```
