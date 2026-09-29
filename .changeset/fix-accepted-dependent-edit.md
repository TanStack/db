---
'@tanstack/db': patch
---

Keep an accepted edit of a pending reinsert visible when an older delete settles, and preserve the accepted delete if the reinsert fails. Both settlement orders remain correct across truncate replay.
