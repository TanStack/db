---
'@tanstack/powersync-db-collection': patch
---

Support numeric collection keys. Set `numericIds: true` and have `deserializationSchema` convert `id` to a number, for a backend with integer primary keys; the collection key is then the deserialized number. On-demand loads, change tracking, and eviction compare `id` as a number, and local updates and deletes use the key. TypeScript requires `numericIds` exactly when the schema outputs a number `id`. Releasing an on-demand subset no longer revalidates its rows, so a row that fails validation no longer blocks the release.
