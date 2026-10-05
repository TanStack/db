---
'@tanstack/db': patch
---

Fix invalid change messages when a ready callback writes during a sync truncate. Messages from an `onFirstReady` callback or a `status:change` listener now reach subscribers after the truncate's batch. Before, a subscriber could get a second delete, a delete for a row it never held, or a stale row.
