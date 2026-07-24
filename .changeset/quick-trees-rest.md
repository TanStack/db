---
'@tanstack/db': patch
---

Skip unchanged index writes while preserving index bookkeeping after failed
removals. Cache index evaluators and avoid object normalization work for
primitive values to reduce update overhead.
