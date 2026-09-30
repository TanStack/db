---
'@tanstack/db-ivm': patch
---

Share one type dispatch between structural hashing and `equalHashValues`. Value identity, cycle rejection, and the structural work cap do not change. The standalone `@tanstack/db-ivm` entry is about 1 KB smaller when minified (about 245 B with gzip).
