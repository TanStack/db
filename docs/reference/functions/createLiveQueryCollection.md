---
id: createLiveQueryCollection
title: createLiveQueryCollection
---

# Function: createLiveQueryCollection()

## Call Signature

```ts
function createLiveQueryCollection<TQueryFn, TQuery>(query): CollectionForContext<ExtractContext<TQuery>, RootQueryResult<ExtractContext<TQuery>>, {
}> & object;
```

Defined in: [packages/db/src/query/live-query-collection.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/live-query-collection.ts#L128)

Creates a live query collection directly

### Type Parameters

#### TQueryFn

`TQueryFn` *extends* (`q`) => [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\>

#### TQuery

`TQuery` *extends* [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\> = `ReturnType`\<`TQueryFn`\>

### Parameters

#### query

`TQueryFn` & `RootQueryFn`\<`TQuery`\>

### Returns

`CollectionForContext`\<[`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>, `RootQueryResult`\<[`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>\>, \{
\}\> & `object`

### Example

```typescript
// Minimal usage - just pass a query function
const activeUsers = createLiveQueryCollection(
  (q) => q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
    .select(({ user }) => ({ id: user.id, name: user.name }))
)

// Full configuration with custom options
const searchResults = createLiveQueryCollection({
  id: "search-results", // Custom ID (auto-generated if omitted)
  query: (q) => q
    .from({ post: postsCollection })
    .where(({ post }) => like(post.title, `%${searchTerm}%`))
    .select(({ post }) => ({
      id: post.id,
      title: post.title,
      excerpt: post.excerpt,
    })),
  getKey: (item) => item.id, // Custom key function (uses stream key if omitted)
  utils: {
    updateSearchTerm: (newTerm: string) => {
      // Custom utility functions
    }
  }
})
```

## Call Signature

```ts
function createLiveQueryCollection<TQuery, TContext, TUtils>(config): CollectionForContext<TContext, RootQueryResult<TContext>, {
}> & object;
```

Defined in: [packages/db/src/query/live-query-collection.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/query/live-query-collection.ts#L141)

Creates a live query collection directly

### Type Parameters

#### TQuery

`TQuery` *extends* [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\>

#### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md) = [`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = \{
\}

### Parameters

#### config

[`LiveQueryCollectionConfig`](../interfaces/LiveQueryCollectionConfig.md)\<`TContext`, `RootQueryResult`\<`TContext`\>\> & `object`

### Returns

`CollectionForContext`\<`TContext`, `RootQueryResult`\<`TContext`\>, \{
\}\> & `object`

### Example

```typescript
// Minimal usage - just pass a query function
const activeUsers = createLiveQueryCollection(
  (q) => q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
    .select(({ user }) => ({ id: user.id, name: user.name }))
)

// Full configuration with custom options
const searchResults = createLiveQueryCollection({
  id: "search-results", // Custom ID (auto-generated if omitted)
  query: (q) => q
    .from({ post: postsCollection })
    .where(({ post }) => like(post.title, `%${searchTerm}%`))
    .select(({ post }) => ({
      id: post.id,
      title: post.title,
      excerpt: post.excerpt,
    })),
  getKey: (item) => item.id, // Custom key function (uses stream key if omitted)
  utils: {
    updateSearchTerm: (newTerm: string) => {
      // Custom utility functions
    }
  }
})
```
