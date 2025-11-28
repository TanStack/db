---
"@tanstack/react-db": patch
"@tanstack/solid-db": patch
"@tanstack/vue-db": patch
"@tanstack/svelte-db": patch
"@tanstack/angular-db": patch
---

Fixed `isReady` to return `true` for disabled queries in `useLiveQuery`/`injectLiveQuery` across all framework packages. When a query function returns `null` or `undefined` (disabling the query), there's no async operation to wait for, so the hook should be considered "ready" immediately.

Additionally, all frameworks now have proper TypeScript overloads that explicitly support returning `undefined | null` from query functions, making the disabled query pattern type-safe.

This fixes the common pattern where users conditionally enable queries and don't want to show loading states when the query is disabled.
