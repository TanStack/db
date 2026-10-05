---
id: createCursorPager
title: createCursorPager
---

```ts
function createCursorPager<T>(__namedParameters): CursorPager<T>;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:50](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L50)

Fulfill offset/limit windows using opaque backend cursors. Query owns the
pages, freshness, invalidation and garbage collection. Use one dedicated key
per filtered, totally ordered source. Loading more reuses fresh pages; refreshing
stale data rebuilds the loaded sequence from its first page.

The key must not also be used for ordinary QueryCollection row arrays.
Use sibling row/page prefixes under one resource prefix, not pages beneath
the row prefix (manual writes update that whole prefix). For a forced refresh,
cancel the resource prefix before invalidating it. A positive staleTime avoids
refreshing on every read.

Reads on one pager serialize; separate pagers share Query's cache and fetches.
Aborting a reader discards its answer, not shared cached
pages. Cancel the query through QueryClient to cancel its transport. Neither
cancellation nor a TTL can repair a backend's inconsistent cursor sequence.

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

[`CursorPagerOptions`](../interfaces/CursorPagerOptions.md)\<`T`\>

## Returns

[`CursorPager`](../interfaces/CursorPager.md)\<`T`\>
