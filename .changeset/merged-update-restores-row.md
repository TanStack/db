---
'@tanstack/db': patch
---

Drop an update pair from a transaction when the second update restores the row, and leave fields that a later update writes back to their original value out of the merged `changes`.
