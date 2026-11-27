---
'@tanstack/react-db': patch
---

Avoid showing the Suspense fallback for a new `DbClient`-backed browser query when its on-demand acquisition completes synchronously. Queries that are still loading continue to suspend, and hydration still uses the server-rendered view first.
