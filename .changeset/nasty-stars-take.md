---
"@tanstack/db": patch
---

Fixed race condition which could result in a live query throwing and becoming stuck after multiple mutations complete asynchronously.
