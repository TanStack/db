---
"@tanstack/db": patch
---

Fixed critical bug where optimistic mutations were lost when their async handlers completed during a truncate operation. The fix captures a snapshot of optimistic state when `truncate()` is called and restores it during commit, then overlays any still-active transactions to handle late-arriving mutations. This ensures client-side optimistic state is preserved through server-initiated must-refetch scenarios.
