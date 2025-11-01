---
"@tanstack/db": patch
---

Add predicate comparison and merging utilities (isWhereSubset, intersectWherePredicates, unionWherePredicates, and related functions) to support predicate push-down in collection sync operations, enabling efficient tracking of loaded data ranges and preventing redundant server requests. Includes performance optimizations for large primitive IN predicates and full support for Date objects in equality, range, and IN clause comparisons.
