---
'@tanstack/offline-transactions': minor
---

Add `followerWrites: 'durable'`. A follower tab can now save a write to the shared outbox, so it survives going offline or closing the tab. The current or next leader sends it and reports the result back over BroadcastChannel. The default stays `'online'`.
