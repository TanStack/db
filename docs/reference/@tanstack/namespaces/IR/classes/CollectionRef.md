---
id: CollectionRef
title: CollectionRef
---

# Class: CollectionRef

Defined in: packages/db/src/query/ir.ts:72

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: packages/db/src/query/ir.ts:74

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

Defined in: packages/db/src/query/ir.ts:69

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

Defined in: packages/db/src/query/ir.ts:76

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: packages/db/src/query/ir.ts:75

***

### type

```ts
type: "collectionRef";
```

Defined in: packages/db/src/query/ir.ts:73

#### Overrides

```ts
BaseExpression.type
```
