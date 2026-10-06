---
'@tanstack/db': patch
---

Keep paced mutation persistence serial while a backend write is pending, including after a manual rollback. Preserve admitted optimistic updates and reject dropped calls without canceling other work.
