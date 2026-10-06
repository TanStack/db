---
'@tanstack/db': patch
---

Keep last-write-wins row metadata when a sync transaction begun inside an open one commits first. The open transaction's inserts are reclassified against the new rows. An explicit `metadata.row.set` followed by an insert that becomes a real insert is now cleared, and one followed by an insert that becomes an equal re-insert is now kept.
