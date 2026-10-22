---
id: DescriptorRef
title: DescriptorRef
---

Defined in: [packages/db/src/query/ir.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L128)

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

Defined in: [packages/db/src/query/ir.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L132)

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

Defined in: [packages/db/src/query/ir.ts:134](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L134)

***

### descriptor

```ts
descriptor: CollectionOptionsIdentity<any, any, any, any, any>;
```

Defined in: [packages/db/src/query/ir.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L133)

***

### type

```ts
type: "descriptorRef";
```

Defined in: [packages/db/src/query/ir.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L129)

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

Defined in: [packages/db/src/query/ir.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L146)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L142)

Opaque runtime identity for this unbound source placement.

##### Returns

`string`
