---
'@tanstack/db': patch
'@tanstack/powersync-db-collection': patch
---

Separate cleanup start from settlement so dependent live queries and Effects become terminal when a source Collection starts cleanup. Keep PowerSync cleanup pending until late load-hook and trigger cleanup work settles.
