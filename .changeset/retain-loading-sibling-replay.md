---
'@tanstack/db': patch
---

Keep the last complete live-query result when a new include demand fails while a sibling subscription is still replaying after truncate. A successful sibling load cannot publish an incomplete replacement.
