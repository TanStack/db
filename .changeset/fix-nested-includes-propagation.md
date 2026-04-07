---
'@tanstack/db': patch
---

Fix nested `toArray()` includes not propagating changes at depth 3+. When a query used nested includes like `toArray(runs) → toArray(texts) → concat(toArray(textDeltas))`, changes to the deepest level (e.g., inserting a textDelta) were silently lost because `flushIncludesState` only drained one level of nested buffers. Also throw a clear error when `toArray()` or `concat(toArray())` is used inside expressions like `coalesce()`, instead of silently producing incorrect results.
