---
'@tanstack/offline-transactions': minor
---

Add `followerWrites: 'durable'`. A follower tab can now save a write to the shared outbox, so it survives going offline or closing the tab. The current or next leader sends it and reports the result back over BroadcastChannel. The leader also records a rejection before removing the row, so a follower that misses the report still fails with the server's error. A writer deletes its record when it reads it, and a leader's replay prunes records older than seven days. The default stays `'online'`. `removeFromOutbox()` and `clearOutbox()` now also stop a removed transaction that has not started and fail its writer's transaction; in a durable follower they ask the leader, so a call that already started keeps the server's outcome.
