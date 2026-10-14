---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L155)

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

Defined in: [packages/db/src/query/ir.ts:158](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L158)

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

Defined in: [packages/db/src/query/ir.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L160)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L159)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L156)

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

Defined in: [packages/db/src/query/ir.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L167)

##### Returns

`string`
