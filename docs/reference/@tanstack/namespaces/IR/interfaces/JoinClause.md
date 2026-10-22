---
id: JoinClause
title: JoinClause
---

Defined in: [packages/db/src/query/ir.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L56)

## Properties

### compile()

```ts
compile: (pipeline, joinClauses, sources, mainCollectionId, mainSource, allInputs, cache, queryMapping, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, rawQuery, localFrom, onCompileSubquery, aliasToCollectionId, aliasRemapping, sourceWhereClauses, mainSourceIsParentFiltered, valueIdentity, parentKeyStream?) => NamespacedAndKeyedStream;
```

Defined in: [packages/db/src/query/ir.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L62)

Processes all join clauses, applying lazy loading optimizations and maintaining
alias tracking for per-alias subscriptions (enables self-joins).

#### Parameters

##### pipeline

[`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

##### joinClauses

`JoinClause`[]

##### sources

`Record`\<`string`, [`KeyedStream`](../../../../type-aliases/KeyedStream.md)\>

##### mainCollectionId

`string`

##### mainSource

`string`

##### allInputs

`Record`\<`string`, [`KeyedStream`](../../../../type-aliases/KeyedStream.md)\>

##### cache

`QueryCache`

##### queryMapping

`QueryMapping`

##### collections

`Record`\<`string`, [`Collection`](../../../../interfaces/Collection.md)\>

##### subscriptions

`Record`\<`string`, `CollectionSubscription`\>

##### callbacks

`Record`\<`string`, `LazyCollectionCallbacks`\>

##### lazySources

`Set`\<`string`\>

##### optimizableOrderByCollections

`Record`\<`string`, `OrderByOptimizationInfo`\>

##### setWindowFn

(`windowFn`) => `void`

##### rawQuery

[`QueryIR`](QueryIR.md)

##### localFrom

[`From`](../type-aliases/From.md)

##### onCompileSubquery

(...`args`) => `CompilationResult`

##### aliasToCollectionId

`Record`\<`string`, `string`\>

##### aliasRemapping

`Record`\<`string`, `string`\>

##### sourceWhereClauses

`Map`\<`string`, [`BasicExpression`](../type-aliases/BasicExpression.md)\<`boolean`\>\>

##### mainSourceIsParentFiltered

`boolean`

##### valueIdentity

`ValueIdentity`

##### parentKeyStream?

[`KeyedStream`](../../../../type-aliases/KeyedStream.md)

#### Returns

[`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

***

### from

```ts
from: 
  | CollectionSourceRef
  | QueryRef;
```

Defined in: [packages/db/src/query/ir.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L57)

***

### materialize()

```ts
materialize: (compilation, getRootKey?, reduceJoinedPublicKeys) => MaterializedRootCompilation;
```

Defined in: [packages/db/src/query/ir.ts:65](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L65)

Compiles inline includes into the same D2 graph as their parent relation.
Collection-valued includes become inert bucket references. The public facade
adapter resolves those references after the graph reaches quiescence.

#### Parameters

##### compilation

`CompilationResult`

##### getRootKey?

(`row`) => `unknown`

##### reduceJoinedPublicKeys?

`boolean` = `false`

#### Returns

`MaterializedRootCompilation`

***

### on

```ts
on: BasicExpression<boolean>;
```

Defined in: [packages/db/src/query/ir.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L59)

***

### optimize()

```ts
optimize: (query, groupedClauses) => QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:63](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L63)

Step 4: Apply optimizations by lifting single-source clauses into subqueries.

Creates a new QueryIR with single-source WHERE clauses moved to subqueries
that wrap the original table references. This ensures immutability and prevents
infinite recursion issues.

#### Parameters

##### query

[`QueryIR`](QueryIR.md)

Original QueryIR to optimize

##### groupedClauses

`GroupedWhereClauses`

WHERE clauses grouped by optimization strategy

#### Returns

[`QueryIR`](QueryIR.md)

New QueryIR with optimizations applied

***

### type

```ts
type: "inner" | "left" | "right" | "full" | "outer" | "cross";
```

Defined in: [packages/db/src/query/ir.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L58)
