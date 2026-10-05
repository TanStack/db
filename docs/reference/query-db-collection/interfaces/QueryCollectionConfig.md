---
id: QueryCollectionConfig
title: QueryCollectionConfig
---

Defined in: [packages/query-db-collection/src/query.ts:107](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L107)

Configuration options for creating a Query Collection

## Extends

- `BaseCollectionConfig`\<`T`, `TKey`, `TSchema`, [`QueryCollectionUtils`](QueryCollectionUtils.md)\<`T`, `TKey`, \[`TSchema`\] *extends* \[`never`\] ? `T` : `InferSchemaInput`\<`TSchema`\>, `TError`\>\>

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

Defined in: [packages/query-db-collection/src/query.ts:146](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L146)

Whether the query should automatically run (default: true)

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:181](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L181)

Time in milliseconds after which the collection will be garbage collected
when it has no active subscribers. Defaults to 5 minutes (300000ms).
Sync started without subscribers gets a minimum 50ms grace period.
Pending preloads retain the collection until they settle. Preloading ready
data refreshes the retention period. A non-positive or non-finite value
disables automatic garbage collection.

#### Overrides

```ts
BaseCollectionConfig.gcTime
```

***

### initialData?

```ts
optional initialData: TQueryData | InitialDataFunction<TQueryData>;
```

Defined in: [packages/query-db-collection/src/query.ts:221](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L221)

Data used to initialize the TanStack Query cache for an eager collection.
The value has the original Query response shape and is projected through
the collection's select option before rows are materialized.

***

### initialDataUpdatedAt?

```ts
optional initialDataUpdatedAt: number | () => number | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:229](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L229)

The timestamp TanStack Query uses to determine initialData freshness.

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:258](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L258)

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

Defined in: [packages/query-db-collection/src/query.ts:209](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L209)

***

### persistedGcTime?

```ts
optional persistedGcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:236](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L236)

***

### queryClient

```ts
queryClient: QueryClient;
```

Defined in: [packages/query-db-collection/src/query.ts:142](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L142)

The TanStack Query client instance

***

### queryFn

```ts
queryFn: TQueryFn extends (context) => any[] | Promise<any[]> ? (context) => T[] | Promise<T[]> : TQueryFn;
```

Defined in: [packages/query-db-collection/src/query.ts:131](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L131)

Function that fetches data from the server. Must return the complete collection state

***

### queryKey

```ts
queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:129](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L129)

The query key used by TanStack Query to identify this query

***

### refetchInterval?

```ts
optional refetchInterval: number | false | (query) => number | false | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:153](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L153)

***

### refetchOnMount?

```ts
optional refetchOnMount: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:202](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L202)

***

### refetchOnReconnect?

```ts
optional refetchOnReconnect: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:195](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L195)

***

### refetchOnWindowFocus?

```ts
optional refetchOnWindowFocus: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:188](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L188)

***

### retry?

```ts
optional retry: RetryValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:160](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L160)

***

### retryDelay?

```ts
optional retryDelay: RetryDelayValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:167](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L167)

***

### select()?

```ts
optional select: (data) => T[];
```

Defined in: [packages/query-db-collection/src/query.ts:140](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L140)

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

Defined in: [packages/query-db-collection/src/query.ts:174](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L174)
