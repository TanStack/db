---
'@tanstack/angular-db': major
'@tanstack/browser-db-sqlite-persistence': major
'@tanstack/capacitor-db-sqlite-persistence': major
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': major
'@tanstack/db': major
'@tanstack/db-ivm': major
'@tanstack/db-sqlite-persistence-core': major
'@tanstack/electric-db-collection': major
'@tanstack/electron-db-sqlite-persistence': major
'@tanstack/expo-db-sqlite-persistence': major
'@tanstack/node-db-sqlite-persistence': major
'@tanstack/offline-transactions': patch
'@tanstack/powersync-db-collection': major
'@tanstack/query-db-collection': minor
'@tanstack/react-db': major
'@tanstack/react-native-db-sqlite-persistence': major
'@tanstack/react-router-with-db': major
'@tanstack/rxdb-db-collection': major
'@tanstack/solid-db': major
'@tanstack/svelte-db': major
'@tanstack/tauri-db-sqlite-persistence': major
'@tanstack/trailbase-db-collection': major
'@tanstack/vue-db': major
---

Release the first 1.0 candidate. Remove deprecated pre-1.0 APIs and give
source metadata precedence over colliding selected fields in live queries.
Move the two packages already on stable 1.x to a compatible peer dependency on
`@tanstack/db`, so they can share the app's DB instance during the RC.

Remove Query Collection’s automatic refetch after mutation handlers. Handlers
return `Promise<void>` and must await `collection.utils.refetch()` or write
confirmed data with the `write*` utilities; `{ refetch: false }` is removed.
