---
'@tanstack/electric-db-collection': minor
---

Add `matchHistoryLimit` to control how many recent change and move messages later `awaitMatch` calls replay. The default remains 1,000 messages. Set the limit to zero when predicates are registered before their operations to disable historical replay while preserving live matching, commit acknowledgement and transaction-id evidence.
