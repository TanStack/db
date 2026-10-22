---
id: CollectionRef
title: CollectionRef
---

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new CollectionRef(
   collection, 
   alias, 
   bindingId?): CollectionRef;
```

Defined in: [packages/db/src/query/ir.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L93)

#### Parameters

##### collection

[`CollectionImpl`](../../../../classes/CollectionImpl.md)\<`any`, `string` \| `number`, `any`, `any`, `any`\>

##### alias

`string`

##### bindingId?

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

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

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

Defined in: [packages/db/src/query/ir.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L91)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L90)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L87)

#### Overrides

```ts
BaseExpression.type
```

## Accessors

### bindingId

#### Get Signature

```ts
get bindingId(): string;
```

Defined in: [packages/db/src/query/ir.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L109)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L105)

Opaque runtime identity; aliases are lexical names only.

##### Returns

`string`
