---
id: CollectionRef
title: CollectionRef
---

Defined in: [packages/db/src/query/ir.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L100)

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

Defined in: [packages/db/src/query/ir.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L107)

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L105)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L104)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L101)

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

Defined in: [packages/db/src/query/ir.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L123)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L119)

Opaque runtime identity; aliases are lexical names only.

##### Returns

`string`
