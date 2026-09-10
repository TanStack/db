---
id: QueryCollectionUtils
title: QueryCollectionUtils
---

# Interface: QueryCollectionUtils\<TItem, TKey, TInsertInput, TError\>

Defined in: [packages/query-db-collection/src/query.ts:260](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L260)

Utility methods available on Query Collections for direct writes and manual operations.
Direct writes bypass the normal query/mutation flow and write directly to the synced data store.

## Extends

- `UtilsRecord`

## Type Parameters

### TItem

`TItem` *extends* `object` = `Record`\<`string`, `unknown`\>

The type of items stored in the collection

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the item keys

### TInsertInput

`TInsertInput` *extends* `object` = `TItem`

The type accepted for insert operations

### TError

`TError` = `unknown`

The type of errors that can occur during queries

## Indexable

```ts
[key: string]: any
```

## Properties

### clearError()

```ts
clearError: () => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:305](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L305)

Clear the error state and trigger a refetch of the query

#### Returns

`Promise`\<`void`\>

Promise that resolves when the refetch completes successfully

#### Throws

Error if the refetch fails

***

### dataUpdatedAt

```ts
dataUpdatedAt: number;
```

Defined in: [packages/query-db-collection/src/query.ts:296](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L296)

Get timestamp of last successful data update (in milliseconds)

***

### errorCount

```ts
errorCount: number;
```

Defined in: [packages/query-db-collection/src/query.ts:288](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L288)

Get the number of consecutive sync failures.
Incremented only when query fails completely (not per retry attempt); reset on success.

***

### fetchStatus

```ts
fetchStatus: "idle" | "fetching" | "paused";
```

Defined in: [packages/query-db-collection/src/query.ts:298](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L298)

Get current fetch status

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:283](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L283)

Check if the collection is in an error state

***

### isFetching

```ts
isFetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:290](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L290)

Check if query is currently fetching (initial or background)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:294](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L294)

Check if query is loading for the first time (no data yet)

***

### isRefetching

```ts
isRefetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:292](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L292)

Check if query is refetching in background (not initial fetch)

***

### lastError

```ts
lastError: TError | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:281](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L281)

Get the last error encountered by the query (if any); reset on success

***

### refetch

```ts
refetch: RefetchFn;
```

Defined in: [packages/query-db-collection/src/query.ts:267](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L267)

Manually trigger a refetch of the query

***

### writeBatch()

```ts
writeBatch: (callback) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:277](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L277)

Execute multiple write operations as a single atomic batch to the synced data store

#### Parameters

##### callback

() => `void`

#### Returns

`void`

***

### writeDelete()

```ts
writeDelete: (keys) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:273](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L273)

Delete one or more items directly from the synced data store without triggering a query refetch or optimistic update

#### Parameters

##### keys

`TKey` | `TKey`[]

#### Returns

`void`

***

### writeInsert()

```ts
writeInsert: (data) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:269](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L269)

Insert one or more items directly into the synced data store without triggering a query refetch or optimistic update

#### Parameters

##### data

`TInsertInput` | `TInsertInput`[]

#### Returns

`void`

***

### writeUpdate()

```ts
writeUpdate: (updates) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:271](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L271)

Update one or more items directly in the synced data store without triggering a query refetch or optimistic update

#### Parameters

##### updates

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`void`

***

### writeUpsert()

```ts
writeUpsert: (data) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:275](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L275)

Insert or update one or more items directly in the synced data store without triggering a query refetch or optimistic update

#### Parameters

##### data

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`void`
