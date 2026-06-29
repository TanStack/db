---
'@tanstack/db': patch
---

fix(db): keep deeply nested includes in sync when sibling groups share nested correlation keys

Deeply nested includes could drop or stop updating nested rows when sibling parent groups shared the same nested correlation key, especially when one sibling group was inserted after the initial load. Shared nested pipeline buffers were being drained through route state that was scoped too narrowly, so one branch could consume a buffered update before other branches that referenced the same nested row received it.

Nested route state is now shared at the same scope as the nested buffer and routes updates to every concrete destination branch before clearing the buffer. Snapshot replay still seeds late-arriving sibling groups with already-materialized rows, and recursive pending-change detection ensures deeper routed updates are flushed back up through the result tree.
