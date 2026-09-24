---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

Fail-stop persisted collections when hydration or durability fails, while preserving lifecycle ownership across buffered and recovered sync work. Electric collections now surface these failures through the collection error state instead of continuing from an incomplete durable baseline.
