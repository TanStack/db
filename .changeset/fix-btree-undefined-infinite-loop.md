---
'@tanstack/db': patch
---

Fixed infinite loop in `BTreeIndex.takeInternal` when indexed values are `undefined`.

The BTree uses `undefined` as a special parameter meaning "start from beginning/end", which caused an infinite loop when the actual indexed value was `undefined`.

Added `takeFromStart` and `takeReversedFromEnd` methods to explicitly start from the beginning/end, and introduced a sentinel value for storing `undefined` in the BTree.
