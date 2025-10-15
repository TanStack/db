---
"@tanstack/react-db": patch
---

Add `useLiveInfiniteQuery` hook for infinite scrolling with live updates.

The new `useLiveInfiniteQuery` hook provides an infinite query pattern similar to TanStack Query's `useInfiniteQuery`, but with live updates from your local collection. It uses `liveQueryCollection.utils.setWindow()` internally to efficiently paginate through ordered data without recreating the query on each page fetch.

**Key features:**

- Automatic live updates as data changes in the collection
- Efficient pagination using dynamic window adjustment
- Peek-ahead mechanism to detect when more pages are available
- Compatible with TanStack Query's infinite query API patterns

**Example usage:**

```tsx
import { useLiveInfiniteQuery } from "@tanstack/react-db"

function PostList() {
  const { data, pages, fetchNextPage, hasNextPage, isLoading } =
    useLiveInfiniteQuery(
      (q) =>
        q
          .from({ posts: postsCollection })
          .orderBy(({ posts }) => posts.createdAt, "desc"),
      {
        pageSize: 20,
        getNextPageParam: (lastPage, allPages) =>
          lastPage.length === 20 ? allPages.length : undefined,
      }
    )

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      {pages.map((page, i) => (
        <div key={i}>
          {page.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      ))}
      {hasNextPage && (
        <button onClick={() => fetchNextPage()}>Load More</button>
      )}
    </div>
  )
}
```

**Requirements:**

- Query must include `.orderBy()` for the window mechanism to work
- Returns flattened `data` array and `pages` array for flexible rendering
- Automatically detects new pages when data is synced to the collection
