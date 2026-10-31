---
id: QueryCollectionUtils
title: QueryCollectionUtils
---

Defined in: [packages/query-db-collection/src/query.ts:335](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L335)

Utility methods available on Query Collections for direct writes and manual operations.
Direct writes bypass optimistic mutations and write to the synced data store.
Direct writes do not trigger a Query refetch. On-demand cache edits are
best-effort and do not establish scoped result authority.

## Template

The type of errors that can occur during queries

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

### _TError

`_TError` = `unknown`

## Properties

### dataUpdatedAt

```ts
dataUpdatedAt: number;
```

Defined in: [packages/query-db-collection/src/query.ts:368](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L368)

Get timestamp of last successful data update (in milliseconds)

***

### fetchStatus

```ts
fetchStatus: "idle" | "fetching" | "paused";
```

Defined in: [packages/query-db-collection/src/query.ts:374](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L374)

Get the aggregate observer fetch status. Returns `fetching` if any
observer is fetching, otherwise `paused` if any observer is paused, and
`idle` when every observer is idle or no observers exist.

***

### isFetching

```ts
isFetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:362](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L362)

Check if query is currently fetching (initial or background)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:366](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L366)

Check if query is loading for the first time (no data yet)

***

### isRefetching

```ts
isRefetching: boolean;
```

Defined in: [packages/query-db-collection/src/query.ts:364](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L364)

Check if query is refetching in background (not initial fetch)

***

### refetch

```ts
refetch: RefetchFn;
```

Defined in: [packages/query-db-collection/src/query.ts:345](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L345)

Manually refetch and await the applicable fetch or application boundary.

***

### writeBatch()

```ts
writeBatch: (callback) => Promise<void>;
```

Defined in: [packages/query-db-collection/src/query.ts:357](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L357)

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

Defined in: [packages/query-db-collection/src/query.ts:353](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L353)

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

Defined in: [packages/query-db-collection/src/query.ts:347](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L347)

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

Defined in: [packages/query-db-collection/src/query.ts:349](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L349)

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

Defined in: [packages/query-db-collection/src/query.ts:355](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L355)

Insert or update items without an optimistic update. Resolves when the sync commit applies.

#### Parameters

##### data

`Partial`\<`TItem`\> | `Partial`\<`TItem`\>[]

#### Returns

`Promise`\<`void`\>
