---
'@tanstack/db-sqlite-persistence-core': patch
---

Keep a persisted on-demand load rejected with `AbortError` after its caller aborts, including with a custom abort reason and when its subset lease is unloaded before the source settles. A direct unload without a signal still releases interest in later source failures.
