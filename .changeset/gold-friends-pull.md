---
"@tanstack/db": patch
---

Refactored the way we compute change events over the synced state and the optimistic changes. This fixes a couple of issues where the change events were not being emitted correctly.
