---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

Recover an on-demand Electric collection with uncertified persisted state by loading only demanded subsets. Keep stale cached rows out of the public collection until an Electric snapshot applies, including during coordinator invalidation.
