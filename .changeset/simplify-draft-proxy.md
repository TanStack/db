---
'@tanstack/db': patch
---

Simplify the mutation draft proxy and share one equality walker with `deepEquals`. Change tracking, revert detection, and `deepEquals` results do not change, and draft writes are faster. Iterating a draft array with `for...of` now uses the native Array Iterator. A typical app bundle is about 460 B smaller with gzip.
