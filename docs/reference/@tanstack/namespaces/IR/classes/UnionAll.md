---
id: UnionAll
title: UnionAll
---

# Class: UnionAll

Defined in: [packages/db/src/query/ir.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L116)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionAll(queries): UnionAll;
```

Defined in: [packages/db/src/query/ir.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L124)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L124)

***

### type

```ts
type: "unionAll";
```

Defined in: [packages/db/src/query/ir.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L117)

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

Defined in: [packages/db/src/query/ir.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L128)

##### Returns

`string`
