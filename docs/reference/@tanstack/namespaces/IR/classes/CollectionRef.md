---
id: CollectionRef
title: CollectionRef
---

# Class: CollectionRef

Defined in: [packages/db/src/query/ir.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L72)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(collection, alias): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L74)

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

Defined in: [packages/db/src/query/ir.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L69)

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

Defined in: [packages/db/src/query/ir.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L76)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L75)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L73)

#### Overrides

```ts
BaseExpression.type
```
