---
'@tanstack/db': patch
---

Reclaim collections that start syncing without subscribers, releasing unused live-query subscriptions after a minimum 50ms grace period. Keep pending preloads alive until they settle and refresh retention when preloading ready data; `gcTime: 0` continues to disable automatic GC. Allow Node processes to exit while background collection cleanup is pending.
