---
"@tanstack/db": patch
---

Fix `SingleRowRefProxy` collapsing optional and nullable nested objects to opaque leaves. `createIndex()` and single-row `where` callbacks can now traverse them with optional chaining (`row.updatedAt?.seconds`), matching the query builder's `Ref` behavior; runtime behavior is unchanged.
