---
id: DescriptorRef
title: DescriptorRef
---

Defined in: [packages/db/src/query/ir.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L123)

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

Defined in: [packages/db/src/query/ir.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L127)

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

Defined in: [packages/db/src/query/ir.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L129)

***

### descriptor

```ts
descriptor: CollectionOptionsIdentity<any, any, any, any, any>;
```

Defined in: [packages/db/src/query/ir.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L128)

***

### type

```ts
type: "descriptorRef";
```

Defined in: [packages/db/src/query/ir.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L124)

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

Defined in: [packages/db/src/query/ir.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L141)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L137)

Opaque runtime identity for this unbound source placement.

##### Returns

`string`
