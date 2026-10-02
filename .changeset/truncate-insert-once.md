---
'@tanstack/db': patch
---

Fix a truncate that sent a subscriber two inserts for the same key. When a sync truncate re-applied an optimistic row whose key the same commit also changed, a subscriber without initial state got a second insert for a row it already held.
