---
id: QueryRef
title: QueryRef
---

Defined in: [packages/db/src/query/ir.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L98)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new QueryRef(query, alias): QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L100)

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

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

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

Defined in: [packages/db/src/query/ir.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L102)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L101)

***

### type

```ts
type: "queryRef";
```

Defined in: [packages/db/src/query/ir.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L99)

#### Overrides

```ts
BaseExpression.type
```
