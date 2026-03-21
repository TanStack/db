---
'@tanstack/db': patch
'@tanstack/db-sqlite-persisted-collection-core': patch
'@tanstack/db-browser-wa-sqlite-persisted-collection': patch
'@tanstack/db-cloudflare-do-sqlite-persisted-collection': patch
'@tanstack/db-node-sqlite-persisted-collection': patch
'@tanstack/db-electron-sqlite-persisted-collection': patch
'@tanstack/db-expo-sqlite-persisted-collection': patch
'@tanstack/db-react-native-sqlite-persisted-collection': patch
'@tanstack/db-capacitor-sqlite-persisted-collection': patch
'@tanstack/db-tauri-sqlite-persisted-collection': patch
---

feat(persistence): add SQLite-based offline persistence for collections

Adds a new persistence layer that durably stores collection data in SQLite, enabling applications to survive page reloads and app restarts across browser, Node, mobile, desktop, and edge runtimes.

**Core persistence (`@tanstack/db-sqlite-persisted-collection-core`)**

- New package providing the shared SQLite persistence runtime: hydration, streaming, transaction tracking, and applied-tx pruning
- SQLite core adapter with full query compilation, index management, and schema migration support
- Portable conformance test contracts for runtime-specific adapters

**Browser (`@tanstack/db-browser-wa-sqlite-persisted-collection`)**

- New package for browser persistence via wa-sqlite backed by OPFS
- Single-tab persistence with OPFS-based SQLite storage
- `BrowserCollectionCoordinator` for multi-tab leader-election and cross-tab sync

**Cloudflare Durable Objects (`@tanstack/db-cloudflare-do-sqlite-persisted-collection`)**

- New package for SQLite persistence in Cloudflare Durable Objects runtimes

**Node (`@tanstack/db-node-sqlite-persisted-collection`)**

- New package for Node persistence via SQLite

**Electron (`@tanstack/db-electron-sqlite-persisted-collection`)**

- New package providing Electron main and renderer persistence bridge helpers

**Expo (`@tanstack/db-expo-sqlite-persisted-collection`)**

- New package for Expo persistence via `expo-sqlite`

**React Native (`@tanstack/db-react-native-sqlite-persisted-collection`)**

- New package for React Native persistence via op-sqlite
- Adapter with transaction deadlock prevention and runtime parity coverage

**Capacitor (`@tanstack/db-capacitor-sqlite-persisted-collection`)**

- New package for Capacitor persistence via `@capacitor-community/sqlite`

**Tauri (`@tanstack/db-tauri-sqlite-persisted-collection`)**

- New package for Tauri persistence via `@tauri-apps/plugin-sql`
