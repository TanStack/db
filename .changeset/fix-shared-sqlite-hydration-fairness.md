---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': patch
---

Schedule complete SQLite hydration units fairly without holding coordinator work inside the local hydration scope. Fence stale startup rows after a coordinator reset. Preserve per-Collection leader adapter routing, mutation results across transport retries, terminal coordinator disposal, real-adapter restart order, and promise-discovered shared scheduling.
