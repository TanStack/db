---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Apps without a persisted Collection no longer bundle the persisted initial-render wait. The persistence adapter now supplies the wait, so a typical app is about 230 bytes smaller after gzip.
