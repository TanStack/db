---
'@tanstack/svelte-db': minor
---

Add `useLiveInfiniteQuery` rune for infinite scrolling with live updates.

The new `useLiveInfiniteQuery` provides an infinite query pattern similar to TanStack Query's `useInfiniteQuery`, but integrated with TanStack DB's reactive local collections. It maintains a reactive window into your data, allowing for efficient pagination and automatic updates as data changes.

**Key features:**

- **Automatic Live Updates**: Reactive integration with local collections using Svelte runes.
- **Efficient Pagination**: Uses a dynamic window mechanism to track visible data without re-executing complex queries.
- **Automatic Page Detection**: Includes a built-in peek-ahead strategy to detect if more pages are available without manual `getNextPageParam` logic.
- **Flexible Rendering**: Provides both a flattened `data` array and a structured `pages` array.

**Example usage:**

```svelte
<script lang="ts">
  import { useLiveInfiniteQuery } from "@tanstack/svelte-db";
  import { postsCollection } from "./db";

  const query = useLiveInfiniteQuery(
    (q) =>
      q
        .from({ posts: postsCollection })
        .orderBy(({ posts }) => posts.createdAt, "desc"),
    {
      pageSize: 20,
    }
  );
</script>

{#if query.isLoading}
  <p>Loading...</p>
{:else}
  <div>
    {#each query.pages as page}
      {#each page as post (post.id)}
        <PostCard {post} />
      {/each}
    {/each}

    {#if query.hasNextPage}
      <button
        disabled={query.isFetchingNextPage}
        onclick={() => query.fetchNextPage()}
      >
        {query.isFetchingNextPage ? 'Loading...' : 'Load More'}
      </button>
    {/if}
  </div>
{/if}
```

**Requirements:**

- The query must include an `.orderBy()` clause to support the underlying windowing mechanism.
- Supports both offset-based and cursor-based sync implementations via the standard TanStack DB sync protocol.
