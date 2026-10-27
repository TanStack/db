---
id: useLiveInfiniteQuery
title: useLiveInfiniteQuery
---

## Call Signature

```ts
function useLiveInfiniteQuery<TResult, TKey, TUtils>(liveQueryCollection, config): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>;
```

Defined in: [useLiveInfiniteQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L86)

Page through an ordered live query, growing one live-query Collection's
window with `utils.setWindow()` instead of recreating it per page.

The query must include `.orderBy()`. Its identity follows `useLiveQuery`:
derived from the query IR, or named by `queryKey`. A query whose IR cannot be
hashed throws `UnhashableQueryIRError` unless `queryKey` is supplied.

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

### Returns

[`UseLiveInfiniteQueryReturnWithCollection`](../type-aliases/UseLiveInfiniteQueryReturnWithCollection.md)\<`TResult`, `TKey`, `TUtils`\>

### Example

```ts
const { pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) =>
    q
      .from({ posts: postsCollection })
      .orderBy(({ posts }) => posts.createdAt, `desc`),
  { pageSize: 20 },
)
```

## Call Signature

```ts
function useLiveInfiniteQuery<TContext>(queryFn, config): UseLiveInfiniteQueryReturn<TContext>;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L95)

Page through an ordered live query, growing one live-query Collection's
window with `utils.setWindow()` instead of recreating it per page.

The query must include `.orderBy()`. Its identity follows `useLiveQuery`:
derived from the query IR, or named by `queryKey`. A query whose IR cannot be
hashed throws `UnhashableQueryIRError` unless `queryKey` is supplied.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

#### config

[`UseLiveInfiniteQueryConfig`](../type-aliases/UseLiveInfiniteQueryConfig.md)\<`TContext`\>

### Returns

[`UseLiveInfiniteQueryReturn`](../type-aliases/UseLiveInfiniteQueryReturn.md)\<`TContext`\>

### Example

```ts
const { pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) =>
    q
      .from({ posts: postsCollection })
      .orderBy(({ posts }) => posts.createdAt, `desc`),
  { pageSize: 20 },
)
```
