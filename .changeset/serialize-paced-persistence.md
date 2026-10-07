---
'@tanstack/db': patch
---

Keep paced mutation persistence serial while a backend write is pending, including after rollback. Preserve every admitted write when managers share one strategy. Reject manual commits that bypass strategy timing.
Restore a transaction's prior optimistic changes when a synchronous `mutate` callback throws. Reject all receipts in a failed group of paced mutations.
