---
"@tanstack/db": patch
---

Fix pagination with Date orderBy values when backend has higher precision than JavaScript's millisecond precision. When loading duplicate values during cursor-based pagination, Date values now use a 1ms range query (`gte`/`lt`) instead of exact equality (`eq`) to correctly match all rows that fall within the same millisecond, even if the backend (e.g., PostgreSQL) stores them with microsecond precision.
