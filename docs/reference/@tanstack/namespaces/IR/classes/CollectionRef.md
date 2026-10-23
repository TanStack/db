---
id: CollectionRef
title: CollectionRef
---

Defined in: [packages/db/src/query/ir.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L95)

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

Defined in: [packages/db/src/query/ir.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L102)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L100)

***

### collection

```ts
collection: CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L99)

***

### type

```ts
type: "collectionRef";
```

Defined in: [packages/db/src/query/ir.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L96)

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

Defined in: [packages/db/src/query/ir.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L118)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

Opaque runtime identity; aliases are lexical names only.

##### Returns

`string`
