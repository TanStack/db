---
id: createLiveQueryCollection
title: createLiveQueryCollection
---

# Function: createLiveQueryCollection()

## Call Signature

```ts
function createLiveQueryCollection<TContext, TResult>(query): CollectionForContext<TContext, TResult, {
}> & object;
```

Defined in: packages/db/src/query/live-query-collection.ts:115

Creates a live query collection directly

### Type Parameters

#### TContext

`TContext` *extends* [`Context`](../../interfaces/Context.md)

#### TResult

`TResult` *extends* `object` = \{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}

### Parameters

#### query

(`q`) => [`QueryBuilder`](../../type-aliases/QueryBuilder.md)\<`TContext`\>

### Returns

`CollectionForContext`\<`TContext`, `TResult`, \{
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
function createLiveQueryCollection<TContext, TResult, TUtils>(config): CollectionForContext<TContext, TResult, {
}> & object;
```

Defined in: packages/db/src/query/live-query-collection.ts:125

Creates a live query collection directly

### Type Parameters

#### TContext

`TContext` *extends* [`Context`](../../interfaces/Context.md)

#### TResult

`TResult` *extends* `object` = \{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../../type-aliases/UtilsRecord.md) = \{
\}

### Parameters

#### config

[`LiveQueryCollectionConfig`](../../interfaces/LiveQueryCollectionConfig.md)\<`TContext`, `TResult`\> & `object`

### Returns

`CollectionForContext`\<`TContext`, `TResult`, \{
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
