---
'@tanstack/db-ivm': patch
---

Use row keys for stable tie-breaking in ORDER BY operations instead of hash-based object IDs.

Previously, when multiple rows had equal ORDER BY values, tie-breaking used `globalObjectIdGenerator.getId(key)` which could produce hash collisions and wasn't stable across page reloads for object references. Now, the row key (which is always `string | number` and unique per row) is used directly for tie-breaking, ensuring deterministic and stable ordering.

This also simplifies the internal `TaggedValue` type from a 3-tuple `[K, V, Tag]` to a 2-tuple `[K, V]`, removing unnecessary complexity.
