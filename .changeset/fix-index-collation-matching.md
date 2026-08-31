---
'@tanstack/db': patch
---

Match index collation options by their effective values so indexes remain reusable when optional locale fields are omitted, set to `undefined`, or use equivalent locale identifiers.
