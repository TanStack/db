---
'@tanstack/db-ivm': patch
---

Share one loop for keyed and unkeyed `MultiSet` consolidation. Identity rules do not change. The standalone `@tanstack/db-ivm` entry is about 1 KB smaller when minified (about 345 B with gzip), and consolidation is faster in the measured workloads.
