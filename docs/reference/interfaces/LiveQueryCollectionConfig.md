---
id: LiveQueryCollectionConfig
title: LiveQueryCollectionConfig
---

Defined in: [packages/db/src/query/live/types.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L79)

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

Defined in: [packages/db/src/query/live/types.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L135)

Optional compare options for string sorting.
If provided, these will be used instead of inheriting from the FROM collection.

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/db/src/query/live/types.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L124)

GC time for the collection

***

### getKey()?

```ts
optional getKey: (item) => string | number;
```

Defined in: [packages/db/src/query/live/types.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L102)

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

Defined in: [packages/db/src/query/live/types.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L87)

Unique identifier for the collection
If not provided, defaults to `live-query-${number}` with auto-incrementing number

***

### onDelete?

```ts
optional onDelete: 
  | DeleteMutationFn<TResult, string | number, UtilsRecord, void>
| DeleteMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L114)

***

### onInsert?

```ts
optional onInsert: 
  | InsertMutationFn<TResult, string | number, UtilsRecord, void>
| InsertMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L112)

Optional mutation handlers

***

### onUpdate?

```ts
optional onUpdate: 
  | UpdateMutationFn<TResult, string | number, UtilsRecord, void>
| UpdateMutationFn<TResult, string | number, UtilsRecord, any>;
```

Defined in: [packages/db/src/query/live/types.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L113)

***

### query

```ts
query: 
  | (q) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>
| QueryBuilder<TContext> & RootObjectResultConstraint<TContext>;
```

Defined in: [packages/db/src/query/live/types.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L92)

Query builder function that defines the live query

***

### schema?

```ts
optional schema: undefined;
```

Defined in: [packages/db/src/query/live/types.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L107)

Optional schema for validation

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: [packages/db/src/query/live/types.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L129)

If enabled the collection will return a single object instead of an array

***

### startSync?

```ts
optional startSync: boolean;
```

Defined in: [packages/db/src/query/live/types.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L119)

Start sync / the query immediately
