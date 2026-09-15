---
"@tanstack/db": patch
---

Fix ReDoS (CWE-1333) in `like()`/`ilike()`: patterns are now matched with an iterative two-pointer walk instead of being compiled to a RegExp, so crafted patterns with many `%` wildcards can no longer trigger catastrophic backtracking on near-miss values.
