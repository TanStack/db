---
'@tanstack/db': patch
---

Allow sync adapters to replace rows with `truncate({ markReady: false })` while
preserving Collection status. Keep the existing default readiness behavior.
