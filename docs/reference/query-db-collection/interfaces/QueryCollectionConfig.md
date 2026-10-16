---
id: QueryCollectionConfig
title: QueryCollectionConfig
---

Defined in: [packages/query-db-collection/src/query.ts:119](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L119)

Configuration options for creating a Query Collection

## Extends

- `Omit`\<`BaseCollectionConfig`\<`T`, `TKey`, `TSchema`, [`QueryCollectionUtils`](QueryCollectionUtils.md)\<`T`, `TKey`, \[`TSchema`\] *extends* \[`never`\] ? `T` : `InferSchemaInput`\<`TSchema`\>, `TError`\>\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\>

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

Defined in: [packages/query-db-collection/src/query.ts:198](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L198)

Whether the query should automatically run (default: true)

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:233](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L233)

Time in milliseconds after which the collection will be garbage collected
when it has no active subscribers. Defaults to 5 minutes (300000ms).
Sync started without subscribers gets a minimum 50ms grace period.
Pending preloads retain the collection until they settle. Preloading ready
data refreshes the retention period. A non-positive or non-finite value
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

Defined in: [packages/query-db-collection/src/query.ts:273](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L273)

Data used to initialize the TanStack Query cache for an eager collection.
The value has the original Query response shape and is projected through
the collection's select option before rows are materialized.

***

### initialDataUpdatedAt?

```ts
optional initialDataUpdatedAt: number | () => number | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:281](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L281)

The timestamp TanStack Query uses to determine initialData freshness.

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:310](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L310)

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

Defined in: [packages/query-db-collection/src/query.ts:261](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L261)

***

### onDelete()?

```ts
optional onDelete: (params) => Promise<unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:168](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L168)

#### Parameters

##### params

`DeleteMutationFnParams`\<`T`, `TKey`, [`QueryCollectionUtils`](QueryCollectionUtils.md)\<`T`, `TKey`, \[`TSchema`\] *extends* \[`never`\] ? `T` : `InferSchemaInput`\<`TSchema`\>, `TError`\>\>

#### Returns

`Promise`\<`unknown`\>

***

### onInsert()?

```ts
optional onInsert: (params) => Promise<unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:144](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L144)

#### Parameters

##### params

`InsertMutationFnParams`\<`T`, `TKey`, [`QueryCollectionUtils`](QueryCollectionUtils.md)\<`T`, `TKey`, \[`TSchema`\] *extends* \[`never`\] ? `T` : `InferSchemaInput`\<`TSchema`\>, `TError`\>\>

#### Returns

`Promise`\<`unknown`\>

***

### onUpdate()?

```ts
optional onUpdate: (params) => Promise<unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:156](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L156)

#### Parameters

##### params

`UpdateMutationFnParams`\<`T`, `TKey`, [`QueryCollectionUtils`](QueryCollectionUtils.md)\<`T`, `TKey`, \[`TSchema`\] *extends* \[`never`\] ? `T` : `InferSchemaInput`\<`TSchema`\>, `TError`\>\>

#### Returns

`Promise`\<`unknown`\>

***

### persistedGcTime?

```ts
optional persistedGcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:288](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L288)

***

### queryClient

```ts
queryClient: QueryClient;
```

Defined in: [packages/query-db-collection/src/query.ts:194](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L194)

The TanStack Query client instance

***

### queryFn

```ts
queryFn: TQueryFn extends (context) => any[] | Promise<any[]> ? (context) => T[] | Promise<T[]> : TQueryFn;
```

Defined in: [packages/query-db-collection/src/query.ts:183](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L183)

Function that fetches data from the server. Must return the complete collection state

***

### queryKey

```ts
queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:181](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L181)

The query key used by TanStack Query to identify this query

***

### refetchInterval?

```ts
optional refetchInterval: number | false | (query) => number | false | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:205](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L205)

***

### refetchOnMount?

```ts
optional refetchOnMount: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:254](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L254)

***

### refetchOnReconnect?

```ts
optional refetchOnReconnect: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:247](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L247)

***

### refetchOnWindowFocus?

```ts
optional refetchOnWindowFocus: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:240](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L240)

***

### retry?

```ts
optional retry: RetryValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:212](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L212)

***

### retryDelay?

```ts
optional retryDelay: RetryDelayValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:219](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L219)

***

### select()?

```ts
optional select: (data) => T[];
```

Defined in: [packages/query-db-collection/src/query.ts:192](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L192)

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

Defined in: [packages/query-db-collection/src/query.ts:226](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L226)
