---
'@tanstack/offline-transactions': patch
---

Let a follower tab take over when the Web Locks leader releases or closes. A tab that finds the lock held now waits in its queue, then becomes leader and replays the outbox instead of staying online-only until it reloads. A request made right after a release starts a new acquisition, a listener that releases leadership as it is told the tab leads passes the lock on and can queue again at once; with the BroadcastChannel fallback, such a release also leaves no claim or heartbeat behind, and a leadership callback that throws no longer stops the takeover's replay.
