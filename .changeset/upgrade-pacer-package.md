---
"@tanstack/db": patch
---

Upgrade @tanstack/pacer to v0.16.2 and fix AsyncQueuer API usage. The pacer package API changed significantly, requiring updates to how AsyncQueuer is constructed and items are queued in the queueStrategy implementation.
