---
id: QueryRef
title: QueryRef
---

# Class: QueryRef

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new QueryRef(query, alias): QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L73)

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

Defined in: [packages/db/src/query/ir.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L90)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L89)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L87)

#### Overrides

```ts
BaseExpression.type
```
