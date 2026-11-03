---
'@tanstack/powersync-db-collection': patch
---

Persist writes to PowerSync in the order the application made them. A write now starts only after the earlier write on the same collection is observed by the collection or rejected. Before, a later write could start as soon as the earlier one was written to SQLite, before the collection had observed it.
