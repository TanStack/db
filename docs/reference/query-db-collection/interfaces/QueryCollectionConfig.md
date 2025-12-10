---
id: QueryCollectionConfig
title: QueryCollectionConfig
---

# Interface: QueryCollectionConfig\<T, TQueryFn, TError, TQueryKey, TKey, TSchema, TQueryData\>

Defined in: [packages/query-db-collection/src/query.ts:59](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L59)

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

Defined in: [packages/query-db-collection/src/query.ts:85](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L85)

Whether the query should automatically run (default: true)

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/query-db-collection/src/query.ts:135](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L135)

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

Defined in: [packages/query-db-collection/src/query.ts:81](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L81)

The TanStack Query client instance

***

### queryFn

```ts
queryFn: TQueryFn extends (context) => Promise<any[]> ? (context) => Promise<T[]> : TQueryFn;
```

Defined in: [packages/query-db-collection/src/query.ts:73](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L73)

Function that fetches data from the server. Must return the complete collection state

***

### queryKey

```ts
queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>;
```

Defined in: [packages/query-db-collection/src/query.ts:71](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L71)

The query key used by TanStack Query to identify this query

***

### refetchInterval?

```ts
optional refetchInterval: number | false | (query) => number | false | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:86](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L86)

***

### retry?

```ts
optional retry: RetryValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:93](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L93)

***

### retryDelay?

```ts
optional retryDelay: RetryDelayValue<TError>;
```

Defined in: [packages/query-db-collection/src/query.ts:100](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L100)

***

### select()?

```ts
optional select: (data) => T[];
```

Defined in: [packages/query-db-collection/src/query.ts:79](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L79)

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

Defined in: [packages/query-db-collection/src/query.ts:107](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L107)
