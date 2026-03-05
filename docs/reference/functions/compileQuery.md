---
id: compileQuery
title: compileQuery
---

# Function: compileQuery()

```ts
function compileQuery(
   rawQuery, 
   inputs, 
   collections, 
   subscriptions, 
   callbacks, 
   lazySources, 
   optimizableOrderByCollections, 
   setWindowFn, 
   cache, 
   queryMapping): CompilationResult;
```

Defined in: packages/db/src/query/compiler/index.ts:85

Compiles a query IR into a D2 pipeline

## Parameters

### rawQuery

[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)

The query IR to compile

### inputs

`Record`\<`string`, [`KeyedStream`](../type-aliases/KeyedStream.md)\>

Mapping of source aliases to input streams (e.g., `{ employee: input1, manager: input2 }`)

### collections

`Record`\<`string`, [`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`, `any`, `any`\>\>

Mapping of collection IDs to Collection instances

### subscriptions

`Record`\<`string`, `CollectionSubscription`\>

Mapping of source aliases to CollectionSubscription instances

### callbacks

`Record`\<`string`, `LazyCollectionCallbacks`\>

Mapping of source aliases to lazy loading callbacks

### lazySources

`Set`\<`string`\>

Set of source aliases that should load data lazily

### optimizableOrderByCollections

`Record`\<`string`, `OrderByOptimizationInfo`\>

Map of collection IDs to order-by optimization info

### setWindowFn

(`windowFn`) => `void`

### cache

`QueryCache` = `...`

Optional cache for compiled subqueries (used internally for recursion)

### queryMapping

`QueryMapping` = `...`

Optional mapping from optimized queries to original queries

## Returns

`CompilationResult`

A CompilationResult with the pipeline, source WHERE clauses, and alias metadata
