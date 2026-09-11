---
'@tanstack/react-db': minor
'@tanstack/vue-db': minor
'@tanstack/svelte-db': minor
---

Remove the ignored `getNextPageParam` option from `useLiveInfiniteQuery` and reject it with a clear error when passed at runtime. Delete this callback from your config; for server pagination, use an on-demand Query Collection whose `queryFn` fulfills `meta.loadSubsetOptions`. Document fixed-server-page loading and clarify that `initialPageParam` labels result pages rather than setting a server cursor.
