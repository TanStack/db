---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
---

Fix `useLiveInfiniteQuery` showing an empty idle result on its first render for a synchronously loaded source. The hook now starts sync during render, as `useLiveQuery` does, so the first committed render already shows the ready first page instead of flashing empty content before data arrives. This applies to query callbacks and to supplied live query collections whose window already holds the first page. Renders that never commit are reclaimed by garbage collection, and a React StrictMode double render reuses one collection instead of starting two.
