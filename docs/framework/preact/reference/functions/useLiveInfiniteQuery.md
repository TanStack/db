---
id: useLiveInfiniteQuery
title: useLiveInfiniteQuery
---

# Function: useLiveInfiniteQuery()

Creates a live, windowed query for infinite scrolling in Preact.

## Example

```tsx
import { useLiveInfiniteQuery } from '@tanstack/preact-db'

const result = useLiveInfiniteQuery(
  (q) =>
    q
      .from({ posts: postsCollection })
      .orderBy(({ posts }) => posts.createdAt, 'desc')
      .select(({ posts }) => posts),
  {
    pageSize: 20,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined,
  },
)
```
