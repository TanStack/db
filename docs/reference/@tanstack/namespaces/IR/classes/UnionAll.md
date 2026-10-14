---
id: UnionAll
title: UnionAll
---

Defined in: [packages/db/src/query/ir.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L183)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionAll(queries): UnionAll;
```

Defined in: [packages/db/src/query/ir.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L191)

Result-level UNION ALL. Downstream query clauses see the union result row
shape, not the branch source aliases. Optimizers may push safe operations
into branches, but compiler phases should treat this as a derived relation
unless they are explicitly handling branch lowering.

#### Parameters

##### queries

[`QueryIR`](../interfaces/QueryIR.md)[]

#### Returns

`UnionAll`

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

### queries

```ts
queries: QueryIR[];
```

Defined in: [packages/db/src/query/ir.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L191)

***

### type

```ts
type: "unionAll";
```

Defined in: [packages/db/src/query/ir.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L184)

#### Overrides

```ts
BaseExpression.type
```

## Accessors

### alias

#### Get Signature

```ts
get alias(): string;
```

Defined in: [packages/db/src/query/ir.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L195)

##### Returns

`string`
