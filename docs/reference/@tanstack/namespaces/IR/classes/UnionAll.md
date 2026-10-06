---
id: UnionAll
title: UnionAll
---

Defined in: [packages/db/src/query/ir.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L119)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionAll(queries): UnionAll;
```

Defined in: [packages/db/src/query/ir.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L127)

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

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

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

Defined in: [packages/db/src/query/ir.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L127)

***

### type

```ts
type: "unionAll";
```

Defined in: [packages/db/src/query/ir.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L120)

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

Defined in: [packages/db/src/query/ir.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L131)

##### Returns

`string`
