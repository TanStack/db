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
'@tanstack/offline-transactions': minor
'@tanstack/powersync-db-collection': major
'@tanstack/query-db-collection': minor
'@tanstack/react-db': major
'@tanstack/react-native-db-sqlite-persistence': major
'@tanstack/rxdb-db-collection': major
'@tanstack/solid-db': major
'@tanstack/svelte-db': major
'@tanstack/tauri-db-sqlite-persistence': major
'@tanstack/trailbase-db-collection': major
'@tanstack/vue-db': major
---

Release the first 1.0 candidate. Remove deprecated pre-1.0 APIs and give
published row metadata precedence over colliding selected fields. Structured
source spreads and direct source-row returns keep source attribution; new
functional objects and other projections receive output Collection metadata.
Keep the two packages accidentally released as stable 1.x on their stable
release lines. Both stable minor releases require `@tanstack/db@^1.0.0-rc.0`
for the RC health and restoration settlement APIs; upgrade DB with them.

Convex Collection, Preact DB, and React Router with DB are temporarily private
while their initial npm publication and publishing permissions are arranged.
Restore their public manifests and release entries when they can be published.

Remove Query Collection’s automatic refetch after mutation handlers. Handlers
return `Promise<void>` and must await `collection.utils.refetch()` or write
confirmed data with the `write*` utilities; `{ refetch: false }` is removed.
