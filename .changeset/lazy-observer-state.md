---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/vue-db': patch
'@tanstack/svelte-db': patch
---

Build a live query's keyed `state` map only when code reads it. Most callers read only `data`, so an update no longer builds a second copy of the results:

- The shared live query snapshot and the infinite query window build `state` on first read.
- `useLiveInfiniteQuery` in React reads `state` only when your code reads it.
- Vue and Svelte `useLiveQuery` build their `data` array from the snapshot's ordered rows instead of from `state`.

A retained snapshot still shows the rows from the time it was built.
