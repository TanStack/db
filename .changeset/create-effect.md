---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Add `createEffect` API for reactive delta-driven effects and `useLiveQueryEffect` React hook.

`createEffect` attaches callbacks to a live query's delta stream — firing `onEnter`, `onExit`, and `onUpdate` for row-level query-result transitions and `onBatch` for the full delta batch from each graph run — without materialising the full result set. Supports `skipInitial`, `orderBy` + `limit` (top-K window), joins, lazy loading, transaction coalescing, async disposal with `AbortSignal`, and `onSourceError` / `onError` callbacks.

`useLiveQueryEffect` is the React hook wrapper that manages the effect lifecycle (create on mount, dispose on unmount, recreate on dependency change).
