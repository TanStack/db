---
id: liveQueryCollectionOptions
title: liveQueryCollectionOptions
---

# Function: liveQueryCollectionOptions()

```ts
function liveQueryCollectionOptions<TContext, TResult>(config): CollectionConfigForContext<TContext, TResult, {
}> & object;
```

Defined in: packages/db/src/query/live-query-collection.ts:62

Creates live query collection options for use with createCollection

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TResult

`TResult` *extends* `object` = \{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}

## Parameters

### config

[`LiveQueryCollectionConfig`](../interfaces/LiveQueryCollectionConfig.md)\<`TContext`, `TResult`\>

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
