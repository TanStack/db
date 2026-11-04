---
'@tanstack/powersync-db-collection': patch
---

Fix `collection.reload()` sometimes failing to start the new sync run. Each sync run now tracks changes in its own table. Before, a reload's run reused the retired run's table name, so it failed with "table already exists" when the retired run had not dropped its table yet.
