---
'@tanstack/powersync-db-collection': patch
---

Support numeric collection keys. A `deserializationSchema` may convert `id` to a number, for a backend with integer primary keys; the collection key is then the deserialized number. Sync, on-demand reloads, eviction, and local updates and deletes all use that key.
