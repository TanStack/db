# TODO: Add `createLiveInfiniteQuery` API

## Problem

Currently, `useLiveInfiniteQuery` creates live query collections internally and doesn't accept a pre-created collection. This prevents:

1. **Factory pattern usage** - Cannot create/cache collections outside of React components
2. **Server-side preloading** - Cannot preload infinite queries in route loaders (like TanStack Router's `loader` functions)
3. **Collection reuse** - Cannot share the same collection across multiple components

`useLiveQuery` already supports accepting pre-created collections (see overload 7), but `useLiveInfiniteQuery` lacks this capability.

## Proposed Solution

Add a `createLiveInfiniteQuery` function similar to how TanStack Query has `prefetchInfiniteQuery`. This should:

1. Accept the same parameters as `useLiveInfiniteQuery`:
   - `queryFn` - Query builder function
   - `config` - Configuration object with `pageSize`, `getNextPageParam`, etc.
   - `initialPageParam` - Initial page parameter (similar to TanStack Query)

2. Return a collection that can be:
   - Passed to `useLiveInfiniteQuery`
   - Used in route loaders for server-side preloading
   - Cached using factory pattern

## Example Usage

```ts
// queries.ts - Factory pattern with caching
const cache = new Map<string, ReturnType<typeof createLiveInfiniteQuery>>();

export function getProductsInfiniteQuery(search: ProductsSearchParams) {
  const cacheKey = JSON.stringify(search);

  if (!cache.has(cacheKey)) {
    const collection = createLiveInfiniteQuery(
      (q) => buildProductsQuery(q, search),
      {
        pageSize: 50,
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.length === 50 ? 50 : undefined
      }
    );

    collection.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        cache.delete(cacheKey);
      }
    });

    cache.set(cacheKey, collection);
  }

  return cache.get(cacheKey)!;
}

// Component usage
function ProductList() {
  const search = Route.useSearch();
  const collection = getProductsInfiniteQuery(search);

  const { data, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(collection);
  // ...
}

// Route loader - preload on server
export const Route = createFileRoute('/_layout')({
  loader: ({ context, deps: { search } }) => {
    const collection = getProductsInfiniteQuery(search);
    // Preload first page
    return collection.waitForReady();
  }
});
```

## Related

- Similar to TanStack Query's `prefetchInfiniteQuery` pattern
- Would align with existing `useLiveQuery` overload that accepts collections
- Enables better SSR/SSG support for infinite queries
