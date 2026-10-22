---
'@tanstack/db': patch
---

Resume collection sync when a new subscriber follows a suspended render. Preserve cleanup during startup so a retired sync run does not restart.
