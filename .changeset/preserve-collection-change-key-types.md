---
'@tanstack/db': patch
---

Preserve a Collection's exact key type in current-state and subscription change messages. Compose buffered same-key changes against the last subscriber-visible row so rollback deletes carry the correct value.
