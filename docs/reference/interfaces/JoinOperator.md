---
id: JoinOperator
title: JoinOperator
---

Defined in: [packages/db/src/query/builder/join-operators.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L18)

A join step for `query.join(...)`. Importing a join operator is what brings
the join compiler into a bundle.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](Context.md)

### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

### TJoinType

`TJoinType` *extends* [`JoinType`](../type-aliases/JoinType.md)

## Properties

### on

```ts
on: JoinOnCallback<MergeContextForJoinCallback<TContext, { [K in string | number | symbol]: { [K in string | number | symbol]: TSource[K] extends CollectionImpl<any, any, any, any, any> ? InferCollectionType<any[any]> : TSource[K] extends CollectionOptionsIdentity<any, any, any, any, any> ? InferCollectionType<any[any]> : TSource[K] extends QueryBuilder<TContext> ? ResultValue<TContext> : never }[K] }>>;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:24](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L24)

***

### runtime

```ts
runtime: object;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L28)

#### compile()

```ts
compile: (pipeline, joinClauses, sources, mainCollectionId, mainSource, allInputs, cache, queryMapping, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, rawQuery, localFrom, onCompileSubquery, aliasToCollectionId, aliasRemapping, sourceWhereClauses, mainSourceIsParentFiltered, valueIdentity, parentKeyStream?) => NamespacedAndKeyedStream = processJoins;
```

Processes all join clauses, applying lazy loading optimizations and maintaining
alias tracking for per-alias subscriptions (enables self-joins).

##### Parameters

###### pipeline

[`NamespacedAndKeyedStream`](../type-aliases/NamespacedAndKeyedStream.md)

###### joinClauses

[`JoinClause`](../@tanstack/namespaces/IR/interfaces/JoinClause.md)[]

###### sources

`Record`\<`string`, [`KeyedStream`](../type-aliases/KeyedStream.md)\>

###### mainCollectionId

`string`

###### mainSource

`string`

###### allInputs

`Record`\<`string`, [`KeyedStream`](../type-aliases/KeyedStream.md)\>

###### cache

`QueryCache`

###### queryMapping

`QueryMapping`

###### collections

`Record`\<`string`, [`Collection`](Collection.md)\>

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

[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)

###### localFrom

[`From`](../@tanstack/namespaces/IR/type-aliases/From.md)

###### onCompileSubquery

(...`args`) => `CompilationResult`

###### aliasToCollectionId

`Record`\<`string`, `string`\>

###### aliasRemapping

`Record`\<`string`, `string`\>

###### sourceWhereClauses

`Map`\<`string`, [`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>\>

###### mainSourceIsParentFiltered

`boolean`

###### valueIdentity

`ValueIdentity`

###### parentKeyStream?

[`KeyedStream`](../type-aliases/KeyedStream.md)

##### Returns

[`NamespacedAndKeyedStream`](../type-aliases/NamespacedAndKeyedStream.md)

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

[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)

Original QueryIR to optimize

###### groupedClauses

`GroupedWhereClauses`

WHERE clauses grouped by optimization strategy

##### Returns

[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)

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

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

##### Returns

readonly \[[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md), [`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\][]

***

### source

```ts
source: TSource;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:23](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L23)

***

### type

```ts
type: TJoinType;
```

Defined in: [packages/db/src/query/builder/join-operators.ts:27](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/join-operators.ts#L27)
