---
'@tanstack/db': patch
---

Fix a hang when a joined-filter window's tie request answers synchronously while joined work is pending, and an empty joined-filter window when an eagerly loaded joined source's load settles.
