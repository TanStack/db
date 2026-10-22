---
id: DescriptorRef
title: DescriptorRef
---

Defined in: [packages/db/src/query/ir.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L114)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new DescriptorRef(
   descriptor, 
   alias, 
   bindingId?): DescriptorRef;
```

Defined in: [packages/db/src/query/ir.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L118)

#### Parameters

##### descriptor

`CollectionOptionsIdentity`\<`any`, `any`, `any`, `any`, `any`\>

##### alias

`string`

##### bindingId?

`string`

#### Returns

`DescriptorRef`

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

Defined in: [packages/db/src/query/ir.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L120)

***

### descriptor

```ts
descriptor: CollectionOptionsIdentity<any, any, any, any, any>;
```

Defined in: [packages/db/src/query/ir.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L119)

***

### type

```ts
type: "descriptorRef";
```

Defined in: [packages/db/src/query/ir.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L115)

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

Defined in: [packages/db/src/query/ir.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L132)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L128)

Opaque runtime identity for this unbound source placement.

##### Returns

`string`
