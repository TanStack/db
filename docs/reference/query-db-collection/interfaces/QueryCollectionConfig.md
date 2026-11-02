---
id: QueryCollectionConfig
title: QueryCollectionConfig
---

Defined in: [packages/query-db-collection/src/query.ts:131](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L131)

Configuration options for creating a Query Collection

## Extends

- `Omit`\<`BaseCollectionConfig`\<`T`, `TKey`, `TSchema`, `QueryCollectionHandlerUtils`\<`T`, `TKey`, `TSchema`, `TError`\>\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\>

## Type Parameters

### T

`T` *extends* `object` = `object`

The explicit type of items stored in the collection

### TQueryFn

`TQueryFn` *extends* (`context`) => `any` = (`context`) => `any`

The queryFn type

### TError

`TError` = `unknown`

The type of errors that can occur during queries

### TQueryKey

`TQueryKey` *extends* `QueryKey` = `QueryKey`

The type of the query key

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the item keys

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

The schema type for validation

### TQueryData

`TQueryData` = `Awaited`\<`ReturnType`\<`TQueryFn`\>\>

## Properties

### enabled?

```ts
optional enabled: Enabled<TQueryData, TError, TQueryData, TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:190](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L190)

Whether the query should automatically run (default: true)

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:225](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L225)

Time in milliseconds after which the collection will be garbage collected
when it has no active subscribers. Defaults to 5 minutes (300000ms).
Sync started without subscribers gets a minimum 50ms handoff grace period
until a subscriber attaches. After the last subscriber leaves, gcTime
applies without that startup minimum.
Pending preloads retain the collection until they settle. Preloading ready
data refreshes the retention period. A persisting transaction that touches
the collection also retains it, and the period starts again when the last
one completes or fails, preserving any remaining startup grace. Pending
manual transactions do not retain it; keep a subscription for draft
visibility until commit or rollback. Rolling
back a manual transaction that stayed pending preserves the existing GC
deadline. Cleanup runs at a host idle opportunity after the delay.
A non-positive or non-finite value
disables automatic garbage collection.

#### Overrides

```ts
Omit.gcTime
```

***

### initialData?

```ts
optional initialData: TQueryData | InitialDataFunction<TQueryData>;
```

Defined in: [packages/query-db-collection/src/query.ts:265](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L265)

Data used to initialize the TanStack Query cache for an eager collection.
The value has the original Query response shape and is projected through
the collection's select option before rows are materialized.

***

### initialDataUpdatedAt?

```ts
optional initialDataUpdatedAt: number | () => number | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:273](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L273)

The timestamp TanStack Query uses to determine initialData freshness.

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:302](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L302)

Metadata to pass to the query.
Available in queryFn via context.meta

#### Example

```ts
// Using meta for error context
queryFn: async (context) => {
  try {
    return await api.getTodos(userId)
  } catch (error) {
    // Use meta for better error messages
    throw new Error(
      context.meta?.errorMessage || 'Failed to load todos'
    )
  }
},
meta: {
  errorMessage: `Failed to load todos for user ${userId}`
}
```

***

### networkMode?

```ts
optional networkMode: NetworkMode;
```

Defined in: [packages/query-db-collection/src/query.ts:253](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L253)

***

### onDelete()?

```ts
optional onDelete: (params) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:165](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L165)

#### Parameters

##### params

`DeleteMutationFnParams`\<`T`, `TKey`, `QueryCollectionHandlerUtils`\<`T`, `TKey`, `TSchema`, `TError`\>\>

#### Returns

`Promise`\<`void`\>

***

### onInsert()?

```ts
optional onInsert: (params) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:151](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L151)

Mutation handlers must await an explicit refetch or write confirmed data before settling.

#### Parameters

##### params

`InsertMutationFnParams`\<`T`, `TKey`, `QueryCollectionHandlerUtils`\<`T`, `TKey`, `TSchema`, `TError`\>\>

#### Returns

`Promise`\<`void`\>

***

### onUpdate()?

```ts
optional onUpdate: (params) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:158](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L158)

#### Parameters

##### params

`UpdateMutationFnParams`\<`T`, `TKey`, `QueryCollectionHandlerUtils`\<`T`, `TKey`, `TSchema`, `TError`\>\>

#### Returns

`Promise`\<`void`\>

***

### persistedGcTime?

```ts
optional persistedGcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:280](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L280)

***

### queryClient

```ts
queryClient: QueryClient;
```

Defined in: [packages/query-db-collection/src/query.ts:186](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L186)

The TanStack Query client instance

***

### queryFn

```ts
queryFn: TQueryFn extends (context) => any[] | Promise<any[]> ? (context) => T[] | Promise<T[]> : TQueryFn;
```

Defined in: [packages/query-db-collection/src/query.ts:175](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L175)

Function that fetches data from the server. Must return the complete collection state

***

### queryKey

```ts
queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:173](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L173)

The query key used by TanStack Query to identify this query

***

### refetchInterval?

```ts
optional refetchInterval: number | false | (query) => number | false | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:197](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L197)

***

### refetchOnMount?

```ts
optional refetchOnMount: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:246](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L246)

***

### refetchOnReconnect?

```ts
optional refetchOnReconnect: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:239](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L239)

***

### refetchOnWindowFocus?

```ts
optional refetchOnWindowFocus: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:232](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L232)

***

### retry?

```ts
optional retry: RetryValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:204](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L204)

***

### retryDelay?

```ts
optional retryDelay: RetryDelayValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:211](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L211)

***

### select()?

```ts
optional select: (data) => T[];
```

Defined in: [packages/query-db-collection/src/query.ts:184](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L184)

Extracts the row array TanStack DB materializes from the Query response.
The Query cache keeps the original response shape.

#### Parameters

##### data

`TQueryData`

#### Returns

`T`[]

***

### staleTime?

```ts
optional staleTime: StaleTimeFunction<TQueryData, TError, TQueryData, TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:218](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L218)
