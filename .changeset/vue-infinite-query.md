---
'@tanstack/vue-db': minor
---

Add `useLiveInfiniteQuery` composable for infinite scrolling with live updates.

The new `useLiveInfiniteQuery` provides an infinite query pattern similar to TanStack Query's `useInfiniteQuery`, but integrated with TanStack DB's reactive local collections. It maintains a reactive window into your data, allowing for efficient pagination and automatic updates as data changes.

**Key features:**

- **Automatic Live Updates**: Reactive integration with local collections using Vue 3 composables (ref, computed, watchEffect).
- **Efficient Pagination**: Uses a dynamic window mechanism to track visible data without re-executing complex queries.
- **Automatic Page Detection**: Includes a built-in peek-ahead strategy to detect if more pages are available without manual `getNextPageParam` logic.
- **Flexible Rendering**: Provides both a flattened `data` ref and a structured `pages` ref.

**Example usage:**

```vue
<script setup lang="ts">
import { useLiveInfiniteQuery } from "@tanstack/vue-db";
import { postsCollection } from "./db";

const { data, pages, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
  useLiveInfiniteQuery(
    (q) =>
      q
        .from({ posts: postsCollection })
        .orderBy(({ posts }) => posts.createdAt, "desc"),
    {
      pageSize: 20,
    }
  );
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else>
    <template v-for="page in pages" :key="page">
      <PostCard v-for="post in page" :key="post.id" :post="post" />
    </template>

    <button
      v-if="hasNextPage"
      :disabled="isFetchingNextPage"
      @click="fetchNextPage()"
    >
      {{ isFetchingNextPage ? 'Loading...' : 'Load More' }}
    </button>
  </div>
</template>
```

**Requirements:**

- The query must include an `.orderBy()` clause to support the underlying windowing mechanism.
- Supports both offset-based and cursor-based sync implementations via the standard TanStack DB sync protocol.
