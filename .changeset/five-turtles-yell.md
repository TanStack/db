---
'@tanstack/powersync-db-collection': patch
---

Added checks to not flush records when a `diffTrigger` isn't setup yet for `on-demand` mode. This fixes a non-critical error that was logged on startup.
