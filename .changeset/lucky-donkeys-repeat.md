---
'@tanstack/db': patch
---

Reclaim collections that start syncing without subscribers, releasing unused live-query subscriptions after a minimum 50ms grace period. Keep pending preloads alive until they settle, then apply the unused retention period; `gcTime: 0` continues to disable automatic GC. Allow Node processes to exit while background collection cleanup is pending.
