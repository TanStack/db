---
id: QueryRef
title: QueryRef
---

# Class: QueryRef

Defined in: packages/db/src/query/ir.ts:82

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new QueryRef(query, alias): QueryRef;
```

Defined in: packages/db/src/query/ir.ts:84

#### Parameters

##### query

[`QueryIR`](../../interfaces/QueryIR.md)

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

Defined in: packages/db/src/query/ir.ts:69

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

Defined in: packages/db/src/query/ir.ts:86

***

### query

```ts
query: QueryIR;
```

Defined in: packages/db/src/query/ir.ts:85

***

### type

```ts
type: "queryRef";
```

Defined in: packages/db/src/query/ir.ts:83

#### Overrides

```ts
BaseExpression.type
```
