---
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/capacitor-db-sqlite-persistence': patch
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': patch
'@tanstack/convex-db-collection': patch
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electron-db-sqlite-persistence': patch
'@tanstack/expo-db-sqlite-persistence': patch
'@tanstack/node-db-sqlite-persistence': patch
'@tanstack/query-db-collection': patch
'@tanstack/react-native-db-sqlite-persistence': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/tauri-db-sqlite-persistence': patch
'@tanstack/trailbase-db-collection': patch
---

Make the TypeScript peer dependency optional so JavaScript consumers do not automatically install the compiler. Keep the existing minimum version requirement for projects that install TypeScript.
