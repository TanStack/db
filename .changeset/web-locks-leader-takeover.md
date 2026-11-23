---
'@tanstack/offline-transactions': patch
---

Let a follower tab take over when the Web Locks leader releases or closes. A tab that finds the lock held now waits in its queue, then becomes leader and replays the outbox instead of staying online-only until it reloads.
