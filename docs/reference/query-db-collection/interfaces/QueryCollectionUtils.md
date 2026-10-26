---
id: QueryCollectionUtils
title: QueryCollectionUtils
---

Defined in: [packages/query-db-collection/src/query.ts:301](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L301)

Utility methods available on Query Collections for direct writes and manual operations.
Direct writes bypass optimistic mutations and write to the synced data store.
Direct writes do not trigger a Query refetch. On-demand cache edits are
best-effort and do not establish scoped result authority.

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

Defined in: [packages/query-db-collection/src/query.ts:357](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L357)

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

Defined in: [packages/query-db-collection/src/query.ts:341](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L341)

Get timestamp of last successful data update (in milliseconds)

***

### errorCount

```ts
errorCount: number;
```

Defined in: [packages/query-db-collection/src/query.ts:333](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L333)

Get the number of consecutive sync failures.
Incremented only when query fails completely (not per retry attempt); reset after a successful result applies.

***

### fetchStatus

```ts
fetchStatus: "idle" | "fetching" | "paused";
```

Defined in: [packages/query-db-collection/src/query.ts:347](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L347)

Get the aggregate observer fetch status. Returns `fetching` if any
observer is fetching, otherwise `paused` if any observer is paused, and
`idle` when every observer is idle or no observers exist.

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:328](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L328)

Check if the collection is in an error state

***

### isFetching

```ts
isFetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:335](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L335)

Check if query is currently fetching (initial or background)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:339](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L339)

Check if query is loading for the first time (no data yet)

***

### isRefetching

```ts
isRefetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:337](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L337)

Check if query is refetching in background (not initial fetch)

***

### lastError

```ts
lastError: TError | undefined;
```

Defined in: [packages/query-db-collection/src/query.ts:326](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L326)

Get the last error encountered by the query (if any); reset after a successful result applies

***

### refetch

```ts
refetch: RefetchFn;
```

Defined in: [packages/query-db-collection/src/query.ts:310](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L310)

Manually refetch and await the applicable fetch or application boundary.

***

### writeBatch()

```ts
writeBatch: (callback) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:322](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L322)

Execute direct writes as one atomic batch. Resolves when the sync commit applies.

#### Parameters

##### callback

() => `void`

#### Returns

`Promise`\<`void`\>

***

### writeDelete()

```ts
writeDelete: (keys) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:318](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L318)

Delete items without an optimistic update. Resolves when the sync commit applies.

#### Parameters

##### keys

`TKey` | `TKey`[]

#### Returns

`Promise`\<`void`\>

***

### writeInsert()

```ts
writeInsert: (data) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:312](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L312)

Insert items without an optimistic update. Resolves when the sync commit applies.

#### Parameters

##### data

`TInsertInput` | `TInsertInput`[]

#### Returns

`Promise`\<`void`\>

***

### writeUpdate()

```ts
writeUpdate: (updates) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:314](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L314)

Update items without an optimistic update. Resolves when the sync commit applies.

#### Parameters

##### updates

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`Promise`\<`void`\>

***

### writeUpsert()

```ts
writeUpsert: (data) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:320](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L320)

Insert or update items without an optimistic update. Resolves when the sync commit applies.

#### Parameters

##### data

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`Promise`\<`void`\>
