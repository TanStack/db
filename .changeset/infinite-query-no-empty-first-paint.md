---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
---

Fix `useLiveInfiniteQuery` showing an empty idle result on its first render for a synchronously loaded source. When no source collection is on-demand, the hook now starts sync during render (like `useLiveQuery`), so the first committed render already shows the ready first page instead of flashing empty content before data arrives. Renders that never commit are reclaimed by garbage collection. Queries over on-demand sources still start when the subscription commits, so a duplicate or abandoned render does not send an extra page request.
