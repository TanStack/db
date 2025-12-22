---
'@tanstack/electric-db-collection': patch
---

Fix slow onInsert awaitMatch performance issue

The message buffer was being cleared at the start of each new batch, causing messages to be lost when multiple batches (including heartbeats) arrived before `awaitMatch` was called. This resulted in `awaitMatch` timing out (~3-5s per attempt) and transaction rollbacks.

The fix removes the buffer clearing between batches. Messages are now preserved until the buffer reaches MAX_BATCH_MESSAGES (1000), at which point the oldest messages are dropped. This ensures `awaitMatch` can find messages even when sync activity arrives before the API call completes.
