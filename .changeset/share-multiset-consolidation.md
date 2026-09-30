---
'@tanstack/db-ivm': patch
---

Share one loop for keyed and unkeyed `MultiSet` consolidation. Identity rules do not change, and a `-0` record in single-number data still consolidates to `0`. The standalone `@tanstack/db-ivm` entry is about 970 B smaller when minified (about 325 B with gzip). Consolidation is faster or equal in the measured workloads.
