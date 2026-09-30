---
id: QueryCollectionUtils
title: QueryCollectionUtils
---

Defined in: [packages/query-db-collection/src/query.ts:290](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L290)

Utility methods available on Query Collections for direct writes and manual operations.
Direct writes bypass optimistic mutations and write to the synced data store.
Eager collections patch Query cache; on-demand collections revalidate scoped entries.

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

## Properties

### clearError()

```ts
clearError: () => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:344](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L344)

Refetch, retaining errors until a successful result applies. While a user
mutation is persisting or its handler is active, this retains the Query
fetch boundary so it cannot wait on publication blocked by that
transaction.

#### Returns

`Promise`\<`void`\>

Promise that resolves when the applicable refetch boundary completes

#### Throws

Error if the refetch fails

***

### dataUpdatedAt

```ts
dataUpdatedAt: number;
```

Defined in: [packages/query-db-collection/src/query.ts:328](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L328)

Get timestamp of last successful data update (in milliseconds)

***

### errorCount

```ts
errorCount: number;
```

Defined in: [packages/query-db-collection/src/query.ts:320](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L320)

Get the number of consecutive sync failures.
Incremented only when query fails completely (not per retry attempt); reset after a successful result applies.

***

### fetchStatus

```ts
fetchStatus: "idle" | "fetching" | "paused";
```

Defined in: [packages/query-db-collection/src/query.ts:334](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L334)

Get the aggregate observer fetch status. Returns `fetching` if any
observer is fetching, otherwise `paused` if any observer is paused, and
`idle` when every observer is idle or no observers exist.

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:315](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L315)

Check if the collection is in an error state

***

### isFetching

```ts
isFetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:322](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L322)

Check if query is currently fetching (initial or background)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:326](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L326)

Check if query is loading for the first time (no data yet)

***

### isRefetching

```ts
isRefetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:324](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L324)

Check if query is refetching in background (not initial fetch)

***

### lastError

```ts
lastError: TError | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:313](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L313)

Get the last error encountered by the query (if any); reset after a successful result applies

***

### refetch

```ts
refetch: RefetchFn;
```

Defined in: [packages/query-db-collection/src/query.ts:299](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L299)

Manually refetch and await the applicable fetch or application boundary.

***

### writeBatch()

```ts
writeBatch: (callback) => void;
```

Defined in: [packages/query-db-collection/src/query.ts:309](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L309)

Execute direct writes as one atomic batch, then update or revalidate the Query cache

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

Defined in: [packages/query-db-collection/src/query.ts:305](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L305)

Delete items without an optimistic update. On-demand queries revalidate their scoped cache entries.

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

Defined in: [packages/query-db-collection/src/query.ts:301](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L301)

Insert items without an optimistic update. On-demand queries revalidate their scoped cache entries.

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

Defined in: [packages/query-db-collection/src/query.ts:303](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L303)

Update items without an optimistic update. On-demand queries revalidate their scoped cache entries.

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

Defined in: [packages/query-db-collection/src/query.ts:307](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L307)

Insert or update items without an optimistic update. On-demand queries revalidate their scoped cache entries.

#### Parameters

##### data

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`void`
