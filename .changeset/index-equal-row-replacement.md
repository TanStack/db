---
'@tanstack/db': patch
---

Keep indexes current when a sync write replaces a row with a deep-equal one. A reference-valued field such as a `Map` could stay indexed under its old instance, so a later update left a stale entry and ordered reads could repeat one row and omit another.
