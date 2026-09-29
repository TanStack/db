---
'@tanstack/db': patch
---

Keep publications from a restarted Collection independent of deferrals that cleanup retired. Subscribers now receive the new sync run's changes even when an old deferral handle closes later.
