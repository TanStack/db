---
'@tanstack/query-db-collection': patch
---

Keep shared on-demand Query acquisitions and direct writes correctly owned
across cancellation, reuse, and out-of-order source results. Wait for an
applied source result before settling retained persisted ownership, and reject
opaque persister results that cannot prove revalidation. Reject a canceled
exact snapshot refetch instead of fulfilling from prior cached data.
Preserve a Query behavior's setup error when it rejects before installing a
physical fetch, including retained revalidation. Do not retry that failed
acquisition automatically. Abort abandoned provider work and keep its late
result out of Collection rows and Query cache.
