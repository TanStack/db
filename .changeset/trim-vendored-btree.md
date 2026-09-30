---
'@tanstack/db': patch
---

Reduce the size of the B+ tree that `BTreeIndex` uses. Remove unused features from the vendored `sorted-btree` code and one insert branch that cannot run. Public behavior does not change. The full `@tanstack/db` entry is about 1.4 KB smaller when minified, and about 455 B smaller with gzip.
