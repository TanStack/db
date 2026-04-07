---
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/capacitor-db-sqlite-persistence': patch
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electron-db-sqlite-persistence': patch
'@tanstack/expo-db-sqlite-persistence': patch
'@tanstack/node-db-sqlite-persistence': patch
'@tanstack/react-native-db-sqlite-persistence': patch
'@tanstack/tauri-db-sqlite-persistence': patch
---

Remove unnecessary generic parameters from the SQLite persistence interfaces and adapters.

Collection typing still flows from the collection config, but consumers that explicitly referenced persistence types with `<T, TKey>` should update to the new non-generic interfaces.
