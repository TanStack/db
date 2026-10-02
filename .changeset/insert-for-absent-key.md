---
'@tanstack/db': patch
---

Fix change messages for a row that returns after it was removed. When a sync commit made a row visible again after a completed optimistic request, often a delete, `subscribeChanges` delivered an `update` for a row the subscriber no longer held. It now delivers an `insert`.
