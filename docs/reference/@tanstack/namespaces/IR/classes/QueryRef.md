---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L169)

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

Defined in: [packages/db/src/query/ir.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L172)

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

Defined in: [packages/db/src/query/ir.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L174)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L173)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:170](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L170)

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

Defined in: [packages/db/src/query/ir.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L181)

##### Returns

`string`
