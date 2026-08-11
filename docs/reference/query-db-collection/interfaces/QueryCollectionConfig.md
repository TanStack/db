---
id: QueryCollectionConfig
title: QueryCollectionConfig
---

# Interface: QueryCollectionConfig\<T, TQueryFn, TError, TQueryKey, TKey, TSchema, TQueryData\>

Defined in: [packages/query-db-collection/src/query.ts:95](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L95)

Configuration options for creating a Query Collection

## Extends

- `BaseCollectionConfig`\<`T`, `TKey`, `TSchema`\>

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

Defined in: [packages/query-db-collection/src/query.ts:124](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L124)

Whether the query should automatically run (default: true)

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:159](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L159)

Time in milliseconds after which the collection will be garbage collected
when it has no active subscribers. Defaults to 5 minutes (300000ms).

#### Overrides

```ts
BaseCollectionConfig.gcTime
```

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:216](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L216)

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

Defined in: [packages/query-db-collection/src/query.ts:187](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L187)

***

### persistedGcTime?

```ts
optional persistedGcTime: number;
```

Defined in: [packages/query-db-collection/src/query.ts:194](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L194)

***

### queryClient

```ts
queryClient: QueryClient;
```

Defined in: [packages/query-db-collection/src/query.ts:120](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L120)

The TanStack Query client instance

***

### queryFn

```ts
queryFn: TQueryFn extends (context) => any[] | Promise<any[]> ? (context) => T[] | Promise<T[]> : TQueryFn;
```

Defined in: [packages/query-db-collection/src/query.ts:109](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L109)

Function that fetches data from the server. Must return the complete collection state

***

### queryKey

```ts
queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:107](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L107)

The query key used by TanStack Query to identify this query

***

### refetchInterval?

```ts
optional refetchInterval: number | false | (query) => number | false | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:131](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L131)

***

### refetchOnMount?

```ts
optional refetchOnMount: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:180](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L180)

***

### refetchOnReconnect?

```ts
optional refetchOnReconnect: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:173](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L173)

***

### refetchOnWindowFocus?

```ts
optional refetchOnWindowFocus: boolean | "always" | (query) => boolean | "always";
```

Defined in: [packages/query-db-collection/src/query.ts:166](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L166)

***

### retry?

```ts
optional retry: RetryValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:138](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L138)

***

### retryDelay?

```ts
optional retryDelay: RetryDelayValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:145](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L145)

***

### select()?

```ts
optional select: (data) => T[];
```

Defined in: [packages/query-db-collection/src/query.ts:118](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L118)

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

Defined in: [packages/query-db-collection/src/query.ts:152](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L152)
