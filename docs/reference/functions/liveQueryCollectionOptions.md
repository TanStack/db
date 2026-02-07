---
id: liveQueryCollectionOptions
title: liveQueryCollectionOptions
---

# Function: liveQueryCollectionOptions()

```ts
function liveQueryCollectionOptions<TContext, TResult>(config): CollectionConfigForContext<TContext, TResult, {
}> & object;
```

Defined in: [packages/db/src/query/live-query-collection.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/query/live-query-collection.ts#L62)

Creates live query collection options for use with createCollection

## Virtual properties

Live query results include computed, read-only virtual properties on every row:

- `$synced`: `true` when the row is confirmed by sync; `false` when it is still optimistic.
- `$origin`: `"local"` if the last confirmed change came from this client, otherwise `"remote"`.
- `$key`: the row key for the result.
- `$collectionId`: the source collection ID.

These props can be used in `where`, `select`, and `orderBy` clauses. They are added to
query outputs automatically and should not be persisted back to storage.

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
