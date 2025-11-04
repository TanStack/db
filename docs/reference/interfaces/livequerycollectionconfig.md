---
id: LiveQueryCollectionConfig
title: LiveQueryCollectionConfig
---

# Interface: LiveQueryCollectionConfig\<TContext, TResult\>

Defined in: [packages/db/src/query/live/types.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L49)

Configuration interface for live query collection options

## Example

```typescript
const config: LiveQueryCollectionConfig<any, any> = {
  // id is optional - will auto-generate "live-query-1", "live-query-2", etc.
  query: (q) => q
    .from({ comment: commentsCollection })
    .join(
      { user: usersCollection },
      ({ comment, user }) => eq(comment.user_id, user.id)
    )
    .where(({ comment }) => eq(comment.active, true))
    .select(({ comment, user }) => ({
      id: comment.id,
      content: comment.content,
      authorName: user.name,
    })),
  // getKey is optional - defaults to using stream key
  getKey: (item) => item.id,
}
```

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../Context.md)

### TResult

`TResult` *extends* `object` = [`GetResult`](../../type-aliases/GetResult.md)\<`TContext`\> & `object`

## Properties

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/db/src/query/live/types.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L92)

GC time for the collection

***

### getKey()?

```ts
optional getKey: (item) => string | number;
```

Defined in: [packages/db/src/query/live/types.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L70)

Function to extract the key from result items
If not provided, defaults to using the key from the D2 stream

#### Parameters

##### item

`TResult`

#### Returns

`string` \| `number`

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/query/live/types.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L57)

Unique identifier for the collection
If not provided, defaults to `live-query-${number}` with auto-incrementing number

***

### onDelete?

```ts
optional onDelete: DeleteMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L82)

***

### onInsert?

```ts
optional onInsert: InsertMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L80)

Optional mutation handlers

***

### onUpdate?

```ts
optional onUpdate: UpdateMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L81)

***

### query

```ts
query: 
  | QueryBuilder<TContext>
| (q) => QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/live/types.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L62)

Query builder function that defines the live query

***

### schema?

```ts
optional schema: undefined;
```

Defined in: [packages/db/src/query/live/types.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L75)

Optional schema for validation

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: [packages/db/src/query/live/types.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L97)

If enabled the collection will return a single object instead of an array

***

### startSync?

```ts
optional startSync: boolean;
```

Defined in: [packages/db/src/query/live/types.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L87)

Start sync / the query immediately
