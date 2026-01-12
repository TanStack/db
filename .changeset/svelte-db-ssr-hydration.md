---
'@tanstack/svelte-db': minor
---

Add SSR and hydration support for SvelteKit

New APIs for server-side rendering:

- `createServerContext()` - creates context to collect prefetched queries
- `prefetchLiveQuery()` - prefetches data server-side without starting sync
- `dehydrate()` - serializes context for JSON transport
- `HydrationBoundary` - component that provides hydration context to children

The `useLiveQuery` hook now supports hydration:

- Pass an `id` in the config object to match with server-prefetched data
- Hydrated data is returned immediately while the collection syncs in background
- `isReady` returns `true` when using hydrated data

Also adds subpath exports (`@tanstack/svelte-db/server`, `@tanstack/svelte-db/hydration`) for better tree-shaking.
