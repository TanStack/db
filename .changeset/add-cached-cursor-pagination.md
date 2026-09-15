---
'@tanstack/query-db-collection': patch
---

Add `createCursorPager` to fulfill offset/limit requests from endpoints with opaque continuation tokens. Reuse fresh backend pages through the existing QueryClient, with Query-managed expiry, invalidation and garbage collection, while retaining the existing UI peek-ahead behavior.
