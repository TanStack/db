---
'@tanstack/db': patch
---

Capture pre-sync visible state for keys that a pending sync transaction only writes metadata for, so retiring an optimistic mutation publishes one change event per key instead of two. The duplicated event corrupted multiplicity bookkeeping in live queries, making a later optimistic write on the same key fail with "Query contributors with the same row key are not congruent".
