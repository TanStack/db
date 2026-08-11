---
'@tanstack/powersync-db-collection': patch
---

Fix: applyTransaction hangs forever when a transaction mixes delete+insert on one collection for a same-millisecond tie.
