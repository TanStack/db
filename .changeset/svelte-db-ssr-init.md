---
'@tanstack/svelte-db': patch
---

Fix SSR synchronous initialization for useLiveQuery.

`$effect` doesn't run during server-side rendering, so `internalData` and `state` remained empty even when the collection was populated with initial data via sync config.

This adds synchronous initialization of state and internalData from the collection immediately after `$state` declarations, ensuring data is available for SSR before effects run on the client.
