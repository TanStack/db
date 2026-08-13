---
id: useLiveInfiniteQuery
title: useLiveInfiniteQuery
---

# Function: useLiveInfiniteQuery()

## Call Signature

```ts
function useLiveInfiniteQuery<TResult, TKey, TUtils>(liveQueryCollection, config): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>;
```

Defined in: [useLiveInfiniteQuery.svelte.ts:155](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveInfiniteQuery.svelte.ts#L155)

Create a Svelte-native reactive view over the shared live-query window
controller. The query must include an `orderBy` clause.

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`MaybeGetter`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `NonSingleResult`\>

#### config

[`LiveInfiniteQueryConfig`](../type-aliases/LiveInfiniteQueryConfig.md)\<`TResult`\>

### Returns

[`UseLiveInfiniteQueryReturnWithCollection`](../type-aliases/UseLiveInfiniteQueryReturnWithCollection.md)\<`TResult`, `TKey`, `TUtils`\>

## Call Signature

```ts
function useLiveInfiniteQuery<TContext>(
   queryFn, 
   config, 
deps?): UseLiveInfiniteQueryReturn<TContext>;
```

Defined in: [useLiveInfiniteQuery.svelte.ts:166](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveInfiniteQuery.svelte.ts#L166)

Create a Svelte-native reactive view over the shared live-query window
controller. The query must include an `orderBy` clause.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

#### config

[`UseLiveInfiniteQueryConfig`](../type-aliases/UseLiveInfiniteQueryConfig.md)\<`TContext`\>

#### deps?

() => `unknown`[]

### Returns

[`UseLiveInfiniteQueryReturn`](../type-aliases/UseLiveInfiniteQueryReturn.md)\<`TContext`\>
