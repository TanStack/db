---
"@tanstack/db-ivm": patch
---

Redesign of the join operators with direct algorithms for major performance improvements by replacing composition-based joins (inner+anti) with implementation using mass tracking. Delivers significant performance gains while maintaining full correctness for all join types (inner, left, right, full, anti).
