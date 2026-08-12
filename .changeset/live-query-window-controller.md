---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Add the unstable, internal `createLiveQueryWindowController` primitive for
forward pagination. It coordinates collection-scoped window leases, commits
pages only after subset loads succeed, restores windows after failures and
cleanup, and lets React's `useLiveInfiniteQuery` become a thin binding without
changing its public API or resetting pages for structurally equal dependencies.
