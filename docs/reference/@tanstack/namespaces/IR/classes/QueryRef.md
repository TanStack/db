---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L106)

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

Defined in: [packages/db/src/query/ir.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L109)

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

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

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

Defined in: [packages/db/src/query/ir.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L111)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L110)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L107)

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
