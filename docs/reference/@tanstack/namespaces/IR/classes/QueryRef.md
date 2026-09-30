---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L105)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new QueryRef(query, alias): QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L107)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L109)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L108)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L106)

#### Overrides

```ts
BaseExpression.type
```
