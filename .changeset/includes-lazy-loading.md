---
'@tanstack/db': patch
---

fix: lazy load includes child collections in on-demand sync mode

Includes child collections now use the same lazy loading mechanism as regular joins. When a query uses includes with a correlation WHERE clause (e.g., `.where(({ item }) => eq(item.rootId, r.id))`), only matching child rows are loaded on-demand via `requestSnapshot({ where: inArray(field, keys) })` instead of loading all data upfront. This ensures the sync layer's `queryFn` receives the correlation filter in `loadSubsetOptions`, enabling efficient server-side filtering.
