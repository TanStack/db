---
'@tanstack/db': patch
---

Deliver changes committed inside a subscription's initial-state callback to that subscriber. Previously the subscriber missed them and kept the snapshot's values, while the Collection held the newer rows.
