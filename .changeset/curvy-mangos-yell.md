---
"@tanstack/db": patch
---

Prevent pushing down of where clauses that only touch the namespace of a source, rather than a prop on that namespace. This ensures that the semantics of the query are maintained for things such as `isUndefined(namespace)` after a join.
