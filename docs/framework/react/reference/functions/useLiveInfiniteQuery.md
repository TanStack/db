---
id: useLiveInfiniteQuery
title: useLiveInfiniteQuery
---

# Function: useLiveInfiniteQuery()

## Call Signature

```ts
function useLiveInfiniteQuery<TResult, TKey, TUtils>(liveQueryCollection, config): UseLiveInfiniteQueryReturn<any>;
```

Defined in: [useLiveInfiniteQuery.ts:113](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L113)

Create an infinite query using a query function with live updates

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

[`UseLiveInfiniteQueryConfig`](../../type-aliases/UseLiveInfiniteQueryConfig.md)\<`any`\>

Configuration including pageSize and getNextPageParam

### Returns

[`UseLiveInfiniteQueryReturn`](../../type-aliases/UseLiveInfiniteQueryReturn.md)\<`any`\>

Object with pages, data, and pagination controls

### Examples

```ts
// Basic infinite query
const { data, pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) => q
    .from({ posts: postsCollection })
    .orderBy(({ posts }) => posts.createdAt, 'desc')
    .select(({ posts }) => ({
      id: posts.id,
      title: posts.title
    })),
  {
    pageSize: 20,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined
  }
)
```

```ts
// With dependencies
const { pages, fetchNextPage } = useLiveInfiniteQuery(
  (q) => q
    .from({ posts: postsCollection })
    .where(({ posts }) => eq(posts.category, category))
    .orderBy(({ posts }) => posts.createdAt, 'desc'),
  {
    pageSize: 10,
    getNextPageParam: (lastPage) =>
      lastPage.length === 10 ? lastPage.length : undefined
  },
  [category]
)
```

```ts
// Router loader pattern with pre-created collection
// In loader:
const postsQuery = createLiveQueryCollection({
  query: (q) => q
    .from({ posts: postsCollection })
    .orderBy(({ posts }) => posts.createdAt, 'desc')
    .limit(20)
})
await postsQuery.preload()
return { postsQuery }

// In component:
const { postsQuery } = useLoaderData()
const { data, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  postsQuery,
  {
    pageSize: 20,
    getNextPageParam: (lastPage) => lastPage.length === 20 ? lastPage.length : undefined
  }
)
```

## Call Signature

```ts
function useLiveInfiniteQuery<TContext>(
   queryFn, 
   config, 
deps?): UseLiveInfiniteQueryReturn<TContext>;
```

Defined in: [useLiveInfiniteQuery.ts:123](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L123)

Create an infinite query using a query function with live updates

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

[`UseLiveInfiniteQueryConfig`](../../type-aliases/UseLiveInfiniteQueryConfig.md)\<`TContext`\>

Configuration including pageSize and getNextPageParam

#### deps?

`unknown`[]

Array of dependencies that trigger query re-execution when changed

### Returns

[`UseLiveInfiniteQueryReturn`](../../type-aliases/UseLiveInfiniteQueryReturn.md)\<`TContext`\>

Object with pages, data, and pagination controls

### Examples

```ts
// Basic infinite query
const { data, pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) => q
    .from({ posts: postsCollection })
    .orderBy(({ posts }) => posts.createdAt, 'desc')
    .select(({ posts }) => ({
      id: posts.id,
      title: posts.title
    })),
  {
    pageSize: 20,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined
  }
)
```

```ts
// With dependencies
const { pages, fetchNextPage } = useLiveInfiniteQuery(
  (q) => q
    .from({ posts: postsCollection })
    .where(({ posts }) => eq(posts.category, category))
    .orderBy(({ posts }) => posts.createdAt, 'desc'),
  {
    pageSize: 10,
    getNextPageParam: (lastPage) =>
      lastPage.length === 10 ? lastPage.length : undefined
  },
  [category]
)
```

```ts
// Router loader pattern with pre-created collection
// In loader:
const postsQuery = createLiveQueryCollection({
  query: (q) => q
    .from({ posts: postsCollection })
    .orderBy(({ posts }) => posts.createdAt, 'desc')
    .limit(20)
})
await postsQuery.preload()
return { postsQuery }

// In component:
const { postsQuery } = useLoaderData()
const { data, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  postsQuery,
  {
    pageSize: 20,
    getNextPageParam: (lastPage) => lastPage.length === 20 ? lastPage.length : undefined
  }
)
```
