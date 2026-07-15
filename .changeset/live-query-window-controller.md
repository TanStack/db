---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

feat(db): shared live-query window controller for infinite queries

Adds `createLiveQueryWindowController` to `@tanstack/db` — the framework-agnostic
forward-pagination state machine (loaded-page count, peek-ahead window via
`setWindow`, page slicing, `hasNextPage`/`isFetchingNextPage`) that composes the
live-query observer. `react-db`'s `useLiveInfiniteQuery` is reimplemented as a
thin binding over it with no public API change, so other framework adapters can
build infinite queries on the same shared semantics instead of re-porting the
React hook.
