---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
---

Fix `useLiveInfiniteQuery` showing an empty idle result on its first render for a synchronously loaded source. The hook now starts sync during render, as `useLiveQuery` does, so the first committed render already shows the ready first page instead of flashing empty content before data arrives. This applies to query callbacks and to supplied live query collections whose window is exactly the first page or has no limit. A supplied collection with a wider finite limit waits for the hook to narrow its window at commit, so it never requests rows the hook does not need. Renders that never commit are reclaimed by garbage collection, and a React 19 StrictMode double render reuses one collection instead of starting two. In React, a startup error from a replacement query still reaches the error boundary, and the hook rejects a source replaced by a different collection with the same ID while it is mounted, as `useLiveQuery` does.
