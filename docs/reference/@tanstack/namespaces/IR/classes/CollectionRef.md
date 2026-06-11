---
id: CollectionRef
title: CollectionRef
---

# Class: CollectionRef

Defined in: [packages/db/src/query/ir.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L76)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

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

Defined in: [packages/db/src/query/ir.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L73)

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

Defined in: [packages/db/src/query/ir.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L80)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L77)

#### Overrides

```ts
BaseExpression.type
```
