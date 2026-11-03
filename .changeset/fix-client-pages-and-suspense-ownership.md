---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/preact-db': patch
'@tanstack/svelte-db': patch
---

Keep live-query Collections across finite page changes under a DbClient, including React Suspense and Svelte, while preserving page-specific preload and hydration snapshots. Give independent React Suspense queries separate successful Collections so one query cannot move another query's page. Surface a private Suspense output's failed first load while it is showing copied ready rows, and keep its health independent of a peer's page-request failures. Fix initially disabled keyed query admission in Preact and Svelte, and finish hydration seed handoff when subset work settles without a row or status change.
