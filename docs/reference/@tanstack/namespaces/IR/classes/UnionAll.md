---
id: UnionAll
title: UnionAll
---

Defined in: [packages/db/src/query/ir.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L188)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new UnionAll(queries): UnionAll;
```

Defined in: [packages/db/src/query/ir.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L196)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L196)

***

### type

```ts
type: "unionAll";
```

Defined in: [packages/db/src/query/ir.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L189)

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

Defined in: [packages/db/src/query/ir.ts:200](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L200)

##### Returns

`string`
