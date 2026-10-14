---
'@tanstack/db': patch
---

Publish the first window of an ordered live query synchronously when a full-source fallback returns `true` after applying its rows. This prevents an empty initial result when the first ordered request cannot fill the window.
