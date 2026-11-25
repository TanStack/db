---
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve source commit order when a queued SQLite hydration overlaps later sync writes. Keep partial-update baselines and independent-abort behavior when a subset read fails.
