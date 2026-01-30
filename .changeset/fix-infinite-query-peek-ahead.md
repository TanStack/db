---
"@tanstack/react-db": patch
---

fix(react-db): include peek-ahead item in useLiveInfiniteQuery initial query

The initial query was fetching exactly `pageSize` items, but the peek-ahead logic requires `pageSize + 1` to determine if more pages exist. This caused `hasNextPage` to incorrectly return `false` on initial load when using SQLite predicate push-down with `syncMode: "on-demand"`.
