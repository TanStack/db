---
id: QueryCollectionUtils
title: QueryCollectionUtils
---

# Interface: QueryCollectionUtils\<TItem, TKey, TInsertInput, TError\>

Defined in: [packages/query-db-collection/src/query.ts:235](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L235)

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

Defined in: [packages/query-db-collection/src/query.ts:280](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L280)

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

Defined in: [packages/query-db-collection/src/query.ts:271](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L271)

Get timestamp of last successful data update (in milliseconds)

***

### errorCount

```ts
errorCount: number;
```

Defined in: [packages/query-db-collection/src/query.ts:263](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L263)

Get the number of consecutive sync failures.
Incremented only when query fails completely (not per retry attempt); reset on success.

***

### fetchStatus

```ts
fetchStatus: "idle" | "fetching" | "paused";
```

Defined in: [packages/query-db-collection/src/query.ts:273](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L273)

Get current fetch status

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:258](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L258)

Check if the collection is in an error state

***

### isFetching

```ts
isFetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:265](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L265)

Check if query is currently fetching (initial or background)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:269](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L269)

Check if query is loading for the first time (no data yet)

***

### isRefetching

```ts
isRefetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:267](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L267)

Check if query is refetching in background (not initial fetch)

***

### lastError

```ts
lastError: TError | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:256](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L256)

Get the last error encountered by the query (if any); reset on success

***

### refetch

```ts
refetch: RefetchFn;
```

Defined in: [packages/query-db-collection/src/query.ts:242](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L242)

Manually trigger a refetch of the query

***

### writeBatch()

```ts
writeBatch: (callback) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:252](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L252)

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

Defined in: [packages/query-db-collection/src/query.ts:248](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L248)

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

Defined in: [packages/query-db-collection/src/query.ts:244](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L244)

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

Defined in: [packages/query-db-collection/src/query.ts:246](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L246)

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

Defined in: [packages/query-db-collection/src/query.ts:250](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L250)

Insert or update one or more items directly in the synced data store without triggering a query refetch or optimistic update

#### Parameters

##### data

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`void`
