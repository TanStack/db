---
id: CollectionRef
title: CollectionRef
---

Defined in: [packages/db/src/query/ir.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L91)

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

Defined in: [packages/db/src/query/ir.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L98)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L96)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L95)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L110)

Opaque runtime identity; aliases are lexical names only.

##### Returns

`string`
