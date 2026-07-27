---
id: QueryRef
title: QueryRef
---

# Class: QueryRef

Defined in: [packages/db/src/query/ir.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L95)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new QueryRef(query, alias): QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

#### Parameters

##### query

[`QueryIR`](../interfaces/QueryIR.md)

##### alias

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L99)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L98)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L96)

#### Overrides

```ts
BaseExpression.type
```
