---
id: useLiveInfiniteQuery
title: useLiveInfiniteQuery
---

## Call Signature

```ts
function useLiveInfiniteQuery<TResult, TKey, TUtils>(liveQueryCollection, config): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L95)

Create a Vue-native reactive view over the shared live-query window
controller. The query must include an `orderBy` clause.

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `UtilsRecord`

### Parameters

#### liveQueryCollection

`MaybeRefOrGetter`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `NonSingleResult`\>

#### config

`InfiniteQueryOptions`

### Returns

[`UseLiveInfiniteQueryReturnWithCollection`](../interfaces/UseLiveInfiniteQueryReturnWithCollection.md)\<`TResult`, `TKey`, `TUtils`\>

## Call Signature

```ts
function useLiveInfiniteQuery<TContext>(
   queryFn, 
   config, 
deps?): UseLiveInfiniteQueryReturn<TContext>;
```

Defined in: [useLiveInfiniteQuery.ts:106](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L106)

Create a Vue-native reactive view over the shared live-query window
controller. The query must include an `orderBy` clause.

### Type Parameters

#### TContext

`TContext` *extends* `Context` & `NonSingleResult`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

#### config

`InfiniteQueryOptions`

#### deps?

`unknown`[]

### Returns

[`UseLiveInfiniteQueryReturn`](../interfaces/UseLiveInfiniteQueryReturn.md)\<`TContext`\>
