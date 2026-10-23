---
id: DescriptorRef
title: DescriptorRef
---

Defined in: [packages/db/src/query/ir.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L119)

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

Defined in: [packages/db/src/query/ir.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L123)

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

Defined in: [packages/db/src/query/ir.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L125)

***

### descriptor

```ts
descriptor: CollectionOptionsIdentity<any, any, any, any, any>;
```

Defined in: [packages/db/src/query/ir.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L124)

***

### type

```ts
type: "descriptorRef";
```

Defined in: [packages/db/src/query/ir.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L120)

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

Defined in: [packages/db/src/query/ir.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L137)

##### Returns

`string`

***

### sourceId

#### Get Signature

```ts
get sourceId(): string;
```

Defined in: [packages/db/src/query/ir.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L133)

Opaque runtime identity for this unbound source placement.

##### Returns

`string`
