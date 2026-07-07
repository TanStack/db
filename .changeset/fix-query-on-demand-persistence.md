---
'@tanstack/query-db-collection': patch
---

Keep on-demand load subset subscription state out of TanStack Query metadata so dehydrated query state remains safe to persist with structured-clone based persisters.
