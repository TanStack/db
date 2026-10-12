---
'@tanstack/db': patch
---

Keep ordered snapshots from resending rows already delivered by full-state or skip-filtering subscriptions. Release deleted keys from snapshot tracking. Preserve provider coverage when pending optimistic changes hide rows or change an ordered window.
