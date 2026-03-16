---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Fix Temporal objects breaking live query updates when used with joins. Temporal objects (e.g. `Temporal.PlainDate`) have no enumerable properties, so the structural hash function produced identical hashes for all Temporal values, causing join index updates to be silently swallowed. Also add Temporal support to value normalization for join key matching and to the comparator for correct sort ordering.
