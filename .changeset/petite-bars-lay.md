---
"@tanstack/db": patch
---

Added an auto-indexing system that creates indexes on collection eagerly when querying, this is a performance optimization that can be disabled by setting the autoIndex option to `off`.
