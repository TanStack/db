---
id: LiveQueryCollectionConfig
title: LiveQueryCollectionConfig
---

Defined in: [packages/db/src/query/live/types.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L66)

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

`TContext` *extends* [`Context`](Context.md)

### TResult

`TResult` *extends* `object` = `RootQueryResult`\<`TContext`\>

## Properties

### defaultStringCollation?

```ts
optional defaultStringCollation: StringCollationConfig;
```

Defined in: [packages/db/src/query/live/types.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L130)

Optional compare options for string sorting.
If provided, these will be used instead of inheriting from the FROM collection.

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/db/src/query/live/types.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L119)

GC time for the collection

***

### getKey()?

```ts
optional getKey: (item) => string | number;
```

Defined in: [packages/db/src/query/live/types.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L97)

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

Defined in: [packages/db/src/query/live/types.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L74)

Unique identifier for the collection
If not provided, defaults to `live-query-${number}` with auto-incrementing number

***

### onDelete?

```ts
optional onDelete: 
  | DeleteMutationFn<TResult, string | number, UtilsRecord, void>
| DeleteMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L109)

***

### onInsert?

```ts
optional onInsert: 
  | InsertMutationFn<TResult, string | number, UtilsRecord, void>
| InsertMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L107)

Optional mutation handlers

***

### onUpdate?

```ts
optional onUpdate: 
  | UpdateMutationFn<TResult, string | number, UtilsRecord, void>
| UpdateMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L108)

***

### pool?

```ts
optional pool: object;
```

Defined in: [packages/db/src/query/live/types.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L82)

Framework hooks only: pass `pooledLiveQueries` to serve this query from a
shared equality partition when its shape allows. A config with any option
other than `query`, `gcTime`, and `pool` compiles its own Collection.
`createLiveQueryCollection` does not pool.

#### createPooledLiveQuery()

```ts
createPooledLiveQuery: (query, __namedParameters) => 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | undefined;
```

A pooled view for a query a partition can serve, or undefined. The view is
typed as the Collection it stands in for.

##### Parameters

###### query

[`BaseQueryBuilder`](../classes/BaseQueryBuilder.md)

###### \_\_namedParameters

###### gcTime?

`number` = `5_000`

##### Returns

  \| [`Collection`](Collection.md)\<`any`, `any`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `any`\>
  \| `undefined`

#### getPooledQueryIdentity()

```ts
getPooledQueryIdentity: (query) => string | undefined;
```

The identity of a query a partition can serve with no residual conjunct:
its source and its `eq` fields and literals, which determine its rows.
Undefined for any other query, which keeps the full structural identity.

##### Parameters

###### query

[`BaseQueryBuilder`](../classes/BaseQueryBuilder.md)

##### Returns

`string` \| `undefined`

***

### query

```ts
query: 
  | (q) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>
| QueryBuilder<TContext> & RootObjectResultConstraint<TContext>;
```

Defined in: [packages/db/src/query/live/types.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L87)

Query builder function that defines the live query

***

### schema?

```ts
optional schema: undefined;
```

Defined in: [packages/db/src/query/live/types.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L102)

Optional schema for validation

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: [packages/db/src/query/live/types.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L124)

If enabled the collection will return a single object instead of an array

***

### startSync?

```ts
optional startSync: boolean;
```

Defined in: [packages/db/src/query/live/types.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L114)

Start sync / the query immediately
