---
id: CursorPagerOptions
title: CursorPagerOptions
---

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:10](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L10)

## Type Parameters

### T

`T`

## Properties

### fetchPage()

```ts
fetchPage: (cursor, signal) => Promise<CursorPage<T>>;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:14](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L14)

#### Parameters

##### cursor

`string` | `undefined`

##### signal

`AbortSignal`

#### Returns

`Promise`\<[`CursorPage`](CursorPage.md)\<`T`\>\>

***

### gcTime?

```ts
optional gcTime: number;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:21](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L21)

Query's inactive cache lifetime. Defaults to the QueryClient's setting.

***

### queryClient

```ts
queryClient: QueryClient;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:11](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L11)

***

### queryKey

```ts
queryKey: readonly unknown[];
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:13](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L13)

Dedicated infinite-query key: include the source, filters and order, not the window.

***

### staleTime?

```ts
optional staleTime: number;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:19](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L19)

Query's freshness interval. Defaults to the QueryClient's setting.
