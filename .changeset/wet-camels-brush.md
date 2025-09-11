---
"@tanstack/electric-db-collection": patch
"@tanstack/db": patch
---

Fixed a bug where a live query could get stuck in "loading" state when an electric "must-refetch" message arrived before the first "up-to-date".
