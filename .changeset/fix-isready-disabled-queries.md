---
"@tanstack/react-db": patch
"@tanstack/solid-db": patch
"@tanstack/vue-db": patch
"@tanstack/svelte-db": patch
---

Fixed `isReady` to return `true` for disabled queries in `useLiveQuery` across all framework packages. When a query function returns `null` or `undefined` (disabling the query), there's no async operation to wait for, so the hook should be considered "ready" immediately. This fixes the common pattern where users conditionally enable queries and don't want to show loading states when the query is disabled.
