---
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
---

Fix `useLiveInfiniteQuery` showing an empty idle result on its first render for a synchronously loaded source. The hook now starts sync during render (like `useLiveQuery`), so the first committed render already shows the ready first page instead of flashing empty content before data arrives. Renders that never commit are reclaimed by garbage collection, as `useLiveQuery` already relies on.
