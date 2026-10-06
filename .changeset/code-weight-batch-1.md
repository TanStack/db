---
'@tanstack/db': patch
---

Share duplicated code in direct mutations, index writes, and the query optimizer. The full public API bundle is about 1.4 KB smaller when minified. Errors from a failed `BTreeIndex` expression now carry the original error as `cause`, as `BasicIndex` errors already did.
