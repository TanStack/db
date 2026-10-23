---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L164)

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

Defined in: [packages/db/src/query/ir.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L167)

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

Defined in: [packages/db/src/query/ir.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L169)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L168)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L165)

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

Defined in: [packages/db/src/query/ir.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L176)

##### Returns

`string`
