---
title: TanStack DB Svelte Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/svelte-db
```

## Svelte Utilities

See the [Svelte Functions Reference](./reference/index.md) to see the full list of utilities available in the Svelte Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### DbProvider

Use one `DbClient` for each browser app and one per server request. `DbProvider`
lets queries resolve collection descriptors against that client:

```svelte
<script lang="ts">
  import { DbClient, DbProvider } from '@tanstack/svelte-db'
  import App from './App.svelte'

  const client = new DbClient()
</script>

<DbProvider {client}>
  <App />
</DbProvider>
```

See [SSR and Hydration](../../guides/ssr.md) for server preloading,
dehydration, and snapshot handoff.

### useLiveQuery

The `useLiveQuery` utility creates a live query that automatically updates your component when data changes. It returns reactive values powered by Svelte 5 runes:

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { eq } from '@tanstack/db'

  const query = useLiveQuery({
    query: (q) =>
      q.from({ todos: todosCollection })
       .where(({ todos }) => eq(todos.completed, false))
       .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  })
</script>

{#if query.isLoading}
  <div>Loading...</div>
{:else}
  <ul>
    {#each query.data as todo (todo.id)}
      <li>{todo.text}</li>
    {/each}
  </ul>
{/if}
```

**Note:** With Svelte 5, `useLiveQuery` returns reactive values through getters. Access `query.data` and `query.isLoading` directly (no `$` prefix needed).

### useLiveInfiniteQuery

For ordered, paginated data with live updates, use `useLiveInfiniteQuery`:

```svelte
<script>
  import { useLiveInfiniteQuery } from '@tanstack/svelte-db'
  import { eq } from '@tanstack/db'

  let category = $state('news')
  const query = useLiveInfiniteQuery(
    (q) =>
      q
        .from({ posts: postsCollection })
        .where(({ posts }) => eq(posts.category, category))
        .orderBy(({ posts }) => posts.createdAt, 'desc'),
    { pageSize: 20 },
    [() => category],
  )
</script>

{#each query.data as post (post.id)}
  <article>{post.title}</article>
{/each}

{#if query.hasNextPage}
  <button
    disabled={query.isFetchingNextPage}
    onclick={() => query.fetchNextPage()}
  >
    Load more
  </button>
{/if}
```

`fetchNextPage()` returns a promise that resolves after the page request settles. Failures are exposed through `query.error` and do not reject the promise.

The query must include `orderBy`. The dependency array is available only with
the query-function form. You can also pass an ordered, pre-created live query
collection directly.

### Query Identity

`useLiveQuery` derives identity from structured query IR. Svelte also tracks
reactive values read while building the query, so normal builder queries do not
need a dependency array or `queryKey`.

Captured props and state become part of the derived identity:

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { gt } from '@tanstack/db'

  let { minPriority } = $props()

  const query = useLiveQuery({
    query: (q) =>
      q.from({ todos: todosCollection })
       .where(({ todos }) => gt(todos.priority, minPriority))
  })
</script>

<div>{query.data.length} high-priority todos</div>
```

When the derived identity changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The utility shows loading state again

Use `queryKey` for opaque functional variants such as `.fn.where`, because DB
cannot inspect their closed-over values. Pass reactive key values through a
getter:

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'

  let search = $state('ship')

  const query = useLiveQuery({
    queryKey: () => [todosCollection.id, 'search', search],
    query: (q) =>
      q.from({ todos: todosCollection })
       .fn.where(({ todos }) => todos.title.includes(search))
  })
</script>
```

The legacy dependency array remains supported. Prefer derived identity for
structured queries and `queryKey` for opaque ones.

### Accessing Multiple Properties

You can access all status properties directly on the query result:

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { eq } from '@tanstack/db'

  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.active, true))
  )
</script>

<div>
  <div>Status: {query.status}</div>
  <div>Loading: {query.isLoading}</div>
  <div>Ready: {query.isReady}</div>
  <div>Total: {query.data.length}</div>
</div>
```
