---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/node-db-sqlite-persistence': patch
'@tanstack/expo-db-sqlite-persistence': patch
'@tanstack/react-native-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': patch
'@tanstack/capacitor-db-sqlite-persistence': patch
'@tanstack/tauri-db-sqlite-persistence': patch
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': patch
---

Recover persisted on-demand Electric and Query collections after cache claim loss by rotating their SQLite cache and reloading active subsets. Fence retired provider work and expired claims, preserve warm runs on their claimed cache generation, and forward claim lifetime options through SQLite host factories. Forward managed cache operations and claim checks through Electron IPC protocol v3.
