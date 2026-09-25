---
'@tanstack/query-db-collection': patch
---

Fix explicit refetches so calls normally wait for accepted results to reach Collection rows. If a mutation overlaps the call in either start order, use the Query fetch boundary to prevent circular waits and unrelated persistence delays. Mutation handlers preserve the real Collection, transaction, and mutation identities. Cancelled fetches now retire their causal application records without waiting for another fetch.
