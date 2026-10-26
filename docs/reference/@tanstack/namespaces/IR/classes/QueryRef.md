---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L160)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new QueryRef(
   query, 
   alias, 
   bindingId?): QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L163)

#### Parameters

##### query

[`QueryIR`](../interfaces/QueryIR.md)

##### alias

`string`

##### bindingId?

`string`

#### Returns

`QueryRef`

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

Defined in: [packages/db/src/query/ir.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L165)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L164)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L161)

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

Defined in: [packages/db/src/query/ir.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L172)

##### Returns

`string`
