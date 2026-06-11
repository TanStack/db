---
id: liveQueryCollectionOptions
title: liveQueryCollectionOptions
---

# Function: liveQueryCollectionOptions()

```ts
function liveQueryCollectionOptions<TQuery, TContext, TResult>(config): CollectionConfigForContext<TContext, TResult, {
}> & object;
```

Defined in: [packages/db/src/query/live-query-collection.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/query/live-query-collection.ts#L72)

Creates live query collection options for use with createCollection

## Type Parameters

### TQuery

`TQuery` *extends* [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\>

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md) = [`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>

### TResult

`TResult` *extends* `object` = `RootQueryResult`\<`TContext`\>

## Parameters

### config

[`LiveQueryCollectionConfig`](../interfaces/LiveQueryCollectionConfig.md)\<`TContext`, `TResult`\> & `object`

Configuration options for the live query collection

## Returns

`CollectionConfigForContext`\<`TContext`, `TResult`, \{
\}\> & `object`

Collection options that can be passed to createCollection

## Example

```typescript
const options = liveQueryCollectionOptions({
  // id is optional - will auto-generate if not provided
  query: (q) => q
    .from({ post: postsCollection })
    .where(({ post }) => eq(post.published, true))
    .select(({ post }) => ({
      id: post.id,
      title: post.title,
      content: post.content,
    })),
  // getKey is optional - will use stream key if not provided
})

const collection = createCollection(options)
```
