---
id: CollectionRef
title: CollectionRef
---

# Class: CollectionRef

Defined in: [packages/db/src/query/ir.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L85)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L87)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L89)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

#### Overrides

```ts
BaseExpression.type
```
