---
'@tanstack/db': minor
'@tanstack/react-db': minor
---

Add `createEffect` API for reactive delta-driven effects and `useLiveQueryEffect` React hook.

`createEffect` attaches handlers to a live query's delta stream — firing callbacks when rows enter, exit, or update within a query result — without materialising the full result set. Supports per-row and batch handlers, `skipInitial`, `orderBy` + `limit` (top-K window), joins, lazy loading, transaction coalescing, async disposal with `AbortSignal`, and `onSourceError` / `onError` callbacks.

`useLiveQueryEffect` is the React hook wrapper that manages the effect lifecycle (create on mount, dispose on unmount, recreate on dependency change).
