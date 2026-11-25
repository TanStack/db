---
'@tanstack/offline-transactions': minor
---

Add `followerWrites: 'durable'`. A follower tab can now save a write to the shared outbox, so it survives going offline or closing the tab. The current or next leader sends it and reports the result back over BroadcastChannel. The leader also records a rejection before removing the row, so a follower that misses the report still fails with the server's error. A record no writer reads is pruned after seven days. The default stays `'online'`. `removeFromOutbox()` and `clearOutbox()` now also stop a removed transaction that has not started and fail its writer's transaction.
