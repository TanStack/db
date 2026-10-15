---
'@tanstack/db': patch
---

Publish the first window of an ordered live query synchronously when a full-source fallback returns `true` after applying its rows. This prevents an empty initial result when the first ordered request cannot fill the window.

A later full-source fallback without ordering-repair debt can also settle in the current graph turn. Explicit window moves and full-source repairs keep their existing settlement rules.
