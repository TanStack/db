---
'@tanstack/db': patch
---

Fix two cases where a subscriber without initial state got an insert for a row it already held. A sync truncate inserted a re-applied optimistic row twice when the same commit also changed its key. A sync commit inserted a key again when it retired a completed delete that an active optimistic insert covered.
