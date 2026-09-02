---
'@tanstack/powersync-db-collection': patch
---

Serialize PowerSync tracking startup so changes and cleanup cannot race an unpublished trigger, and cancel subset or load-hook work released while startup is suspended.
