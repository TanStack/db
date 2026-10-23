---
id: JoinClause
title: JoinClause
---

Defined in: [packages/db/src/query/ir.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L54)

## Properties

### from

```ts
from: 
  | CollectionSourceRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L55)

***

### on

```ts
on: BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/ir.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L57)

***

### runtime

```ts
runtime: object;
```

Defined in: [packages/db/src/query/ir.ts:60](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L60)

#### compile()

```ts
compile: (pipeline, joinClauses, sources, mainCollectionId, mainSource, allInputs, cache, queryMapping, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, rawQuery, localFrom, onCompileSubquery, aliasToCollectionId, aliasRemapping, sourceWhereClauses, mainSourceIsParentFiltered, valueIdentity, parentKeyStream?) => NamespacedAndKeyedStream = processJoins;
```

Processes all join clauses, applying lazy loading optimizations and maintaining
alias tracking for per-alias subscriptions (enables self-joins).

##### Parameters

###### pipeline

[`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

###### joinClauses

`JoinClause`[]

###### sources

`Record`\<`string`, [`KeyedStream`](../../../../type-aliases/KeyedStream.md)\>

###### mainCollectionId

`string`

###### mainSource

`string`

###### allInputs

`Record`\<`string`, [`KeyedStream`](../../../../type-aliases/KeyedStream.md)\>

###### cache

`QueryCache`

###### queryMapping

`QueryMapping`

###### collections

`Record`\<`string`, [`Collection`](../../../../interfaces/Collection.md)\>

###### subscriptions

`Record`\<`string`, `CollectionSubscription`\>

###### callbacks

`Record`\<`string`, `LazyCollectionCallbacks`\>

###### lazySources

`Set`\<`string`\>

###### optimizableOrderByCollections

`Record`\<`string`, `OrderByOptimizationInfo`\>

###### setWindowFn

(`windowFn`) => `void`

###### rawQuery

[`QueryIR`](QueryIR.md)

###### localFrom

[`From`](../type-aliases/From.md)

###### onCompileSubquery

(...`args`) => `CompilationResult`

###### aliasToCollectionId

`Record`\<`string`, `string`\>

###### aliasRemapping

`Record`\<`string`, `string`\>

###### sourceWhereClauses

`Map`\<`string`, [`BasicExpression`](../type-aliases/BasicExpression.md)\<`boolean`\>\>

###### mainSourceIsParentFiltered

`boolean`

###### valueIdentity

`ValueIdentity`

###### parentKeyStream?

[`KeyedStream`](../../../../type-aliases/KeyedStream.md)

##### Returns

[`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

#### optimize()

```ts
optimize: (query, groupedClauses) => QueryIR = applyOptimizations;
```

Step 4: Apply optimizations by lifting single-source clauses into subqueries.

Creates a new QueryIR with single-source WHERE clauses moved to subqueries
that wrap the original table references. This ensures immutability and prevents
infinite recursion issues.

##### Parameters

###### query

[`QueryIR`](QueryIR.md)

Original QueryIR to optimize

###### groupedClauses

`GroupedWhereClauses`

WHERE clauses grouped by optimization strategy

##### Returns

[`QueryIR`](QueryIR.md)

New QueryIR with optimizations applied

#### reducePublicKeys()

```ts
reducePublicKeys: (compilation, getKey) => object;
```

Reduces a query without includes to one canonical row per public key.

##### Parameters

###### compilation

`CompilationResult`

###### getKey

(`row`) => `unknown`

##### Returns

`object`

###### facades

```ts
facades: undefined;
```

###### pipeline

```ts
pipeline: ResultStream;
```

#### validate()

```ts
validate: (expression) => readonly [BasicExpression, BasicExpression][] = validateJoinConditions;
```

Validate join syntax and return its equality operands in source order.

##### Parameters

###### expression

[`BasicExpression`](../type-aliases/BasicExpression.md)

##### Returns

readonly \[[`BasicExpression`](../type-aliases/BasicExpression.md), [`BasicExpression`](../type-aliases/BasicExpression.md)\][]

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L56)
