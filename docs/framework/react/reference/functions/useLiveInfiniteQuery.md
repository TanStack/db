---
id: useLiveInfiniteQuery
title: useLiveInfiniteQuery
---

## Call Signature

```ts
function useLiveInfiniteQuery<TResult, TKey, TUtils>(liveQueryCollection, config): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>;
```

Defined in: [useLiveInfiniteQuery.ts:135](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L135)

Create an infinite query using a query function with live updates.

Uses `utils.setWindow()` to dynamically adjust the limit/offset window
without recreating the live query collection on each page change.

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `NonSingleResult`

#### config

[`UseLiveInfiniteQueryConfig`](../type-aliases/UseLiveInfiniteQueryConfig.md)\<`any`\>

Configuration including pageSize and an optional initial page label

### Returns

[`UseLiveInfiniteQueryReturnWithCollection`](../type-aliases/UseLiveInfiniteQueryReturnWithCollection.md)\<`TResult`, `TKey`, `TUtils`\>

Object with pages, data, and pagination controls

## Call Signature

```ts
function useLiveInfiniteQuery<TContext>(
   queryFn, 
   config, 
deps?): UseLiveInfiniteQueryReturn<TContext>;
```

Defined in: [useLiveInfiniteQuery.ts:145](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L145)

Create an infinite query using a query function with live updates.

Uses `utils.setWindow()` to dynamically adjust the limit/offset window
without recreating the live query collection on each page change.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch. Must include `.orderBy()` for setWindow to work.

#### config

[`UseLiveInfiniteQueryConfig`](../type-aliases/UseLiveInfiniteQueryConfig.md)\<`TContext`\>

Configuration including pageSize and an optional initial page label

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

[`UseLiveInfiniteQueryReturn`](../type-aliases/UseLiveInfiniteQueryReturn.md)\<`TContext`\>

Object with pages, data, and pagination controls
