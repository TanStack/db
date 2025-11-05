---
id: QueryCollectionConfig
title: QueryCollectionConfig
---

# Interface: QueryCollectionConfig\<T, TQueryFn, TError, TQueryKey, TKey, TSchema, TQueryData\>

Defined in: [packages/query-db-collection/src/query.ts:54](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L54)

Configuration options for creating a Query Collection

## Extends

- `BaseCollectionConfig`\<`T`, `TKey`, `TSchema`\>

## Type Parameters

### T

`T` *extends* `object` = `object`

The explicit type of items stored in the collection

### TQueryFn

`TQueryFn` *extends* (`context`) => `Promise`\<`any`\> = (`context`) => `Promise`\<`any`\>

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
optional enabled: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:80](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L80)

Whether the query should automatically run (default: true)

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:130](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L130)

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

### queryClient

```ts
queryClient: QueryClient;
```

Defined in: [packages/query-db-collection/src/query.ts:76](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L76)

The TanStack Query client instance

***

### queryFn

```ts
queryFn: TQueryFn extends (context) => Promise<any[]> ? (context) => Promise<T[]> : TQueryFn;
```

Defined in: [packages/query-db-collection/src/query.ts:68](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L68)

Function that fetches data from the server. Must return the complete collection state

***

### queryKey

```ts
queryKey: TQueryKey;
```

Defined in: [packages/query-db-collection/src/query.ts:66](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L66)

The query key used by TanStack Query to identify this query

***

### refetchInterval?

```ts
optional refetchInterval: number | false | (query) => number | false | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:81](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L81)

***

### retry?

```ts
optional retry: RetryValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:88](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L88)

***

### retryDelay?

```ts
optional retryDelay: RetryDelayValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:95](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L95)

***

### select()?

```ts
optional select: (data) => T[];
```

Defined in: [packages/query-db-collection/src/query.ts:74](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L74)

#### Parameters

##### data

`TQueryData`

#### Returns

`T`[]

***

### staleTime?

```ts
optional staleTime: StaleTimeFunction<T[], TError, T[], TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:102](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L102)
