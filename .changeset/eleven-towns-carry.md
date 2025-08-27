---
"@tanstack/electric-db-collection": patch
---

fix the handling of an electric must-refetch message so that the truncate is handled in the same transaction as the next up-to-date, ensuring you don't get a momentary empty collection.
