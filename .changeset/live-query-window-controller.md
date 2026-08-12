---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

feat(db): internal shared live-query window controller for infinite queries

Adds the unstable, `@internal` `createLiveQueryWindowController` adapter
primitive to `@tanstack/db`. It owns forward pagination, collection-scoped
window leases, transactional page commits, and failure/retry state while the
RFC contract is finalized. `react-db`'s `useLiveInfiniteQuery` becomes a thin
binding over it with no public API change.
